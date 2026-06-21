import { runCascade } from '../../../lib/orchestrator';
import { AGENTS, buildRound1Prompt, buildRound2Prompt, buildVerdictPrompt } from '../../../lib/agents';
import { streamGemini } from '../../../lib/gemini';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { idea, apiKey: clientApiKey, action, agentId, round, round1Results, allResponses } = await req.json();
    
    // Choose the API key (prefer server-side GEMINI_API_KEY if configured)
    const apiKey = process.env.GEMINI_API_KEY || clientApiKey;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Gemini API Key is missing. Please set GEMINI_API_KEY in your .env or input it in the UI.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();

    // Handle single-agent retry streaming
    if (action === 'retry_agent') {
      const agent = AGENTS.find(a => a.id === agentId);
      if (!agent) {
        return new Response(JSON.stringify({ error: `Agent ${agentId} not found` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (eventData) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`));
            } catch (e) {
              console.error('SSE enqueue error:', e);
            }
          };

          try {
            sendEvent({ type: 'agent_start', agentId: agent.id, round: round, agentName: agent.name });
            
            const prompt = round === 'Round 1'
              ? buildRound1Prompt(agent, idea)
              : buildRound2Prompt(agent, idea, round1Results);
              
            let accumulatedContent = '';
            for await (const chunk of streamGemini(prompt, apiKey)) {
              if (req.signal.aborted) {
                console.log(`Agent retry aborted for ${agent.id}`);
                return;
              }
              accumulatedContent += chunk;
              sendEvent({ 
                type: 'agent_chunk', 
                agentId: agent.id, 
                round: round, 
                agentName: agent.name, 
                chunk, 
                content: accumulatedContent 
              });
            }

            sendEvent({ 
              type: 'agent_complete', 
              agentId: agent.id, 
              round: round, 
              agentName: agent.name, 
              content: accumulatedContent.trim() 
            });
          } catch (err) {
            sendEvent({ type: 'agent_error', agentId: agent.id, round: round, error: err.message });
          } finally {
            try {
              controller.close();
            } catch (e) {}
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    // Handle final verdict retry streaming
    if (action === 'retry_verdict') {
      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (eventData) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`));
            } catch (e) {
              console.error('SSE enqueue error:', e);
            }
          };

          try {
            sendEvent({ type: 'verdict_start' });
            const verdictPrompt = buildVerdictPrompt(idea, allResponses);
            let accumulatedContent = '';
            for await (const chunk of streamGemini(verdictPrompt, apiKey)) {
              if (req.signal.aborted) {
                console.log('Verdict retry aborted');
                return;
              }
              accumulatedContent += chunk;
              sendEvent({ type: 'verdict_chunk', chunk, content: accumulatedContent });
            }
            sendEvent({ type: 'verdict_complete', content: accumulatedContent.trim() });
          } catch (err) {
            sendEvent({ type: 'verdict_error', error: err.message });
          } finally {
            try {
              controller.close();
            } catch (e) {}
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    // Standard complete Cascade pipeline stream
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (eventData) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`));
          } catch (e) {
            console.error('SSE enqueue error:', e);
          }
        };

        try {
          await runCascade(idea, apiKey, (event) => {
            sendEvent(event);
          }, req.signal);
        } catch (err) {
          sendEvent({ type: 'fatal_error', error: err.message });
        } finally {
          try {
            controller.close();
          } catch (e) {
            // Ignore if already closed
          }
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('API /api/debate error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
