/**
 * Multi-Agent Orchestrator for Cascade
 * 
 * Manages the debate flow:
 * 1. Round 1: All 5 agents independently critique the idea (parallel streaming)
 * 2. Round 2: Each agent reads the others' critiques and rebuts (sequential streaming to respect rate limits)
 * 3. Verdict: A synthesizer agent produces the final assessment (streaming)
 */

import { AGENTS, buildRound1Prompt, buildRound2Prompt, buildVerdictPrompt } from './agents';
import { streamGemini } from './gemini';

/**
 * Run the full Cascade debate pipeline
 * 
 * @param {string} idea - The startup idea to evaluate
 * @param {string} apiKey - Gemini API key
 * @param {function} onEvent - Callback for streaming events to the client
 * @param {AbortSignal} [signal] - Signal to abort the operation
 *   Events: { type: 'phase' | 'agent_start' | 'agent_chunk' | 'agent_complete' | 'agent_error' | 'phase_complete' | 'verdict_start' | 'verdict_chunk' | 'verdict_complete' | 'verdict_error' | 'complete' | 'fatal_error', agentId?, content?, chunk?, round?, phase?, message?, error?, agentName? }
 */
export async function runCascade(idea, apiKey, onEvent, signal) {
  const allResponses = [];

  try {
    // ===== ROUND 1: Independent Critiques =====
    onEvent({ type: 'phase', phase: 'round1', message: 'Round 1: Independent Analysis' });

    const round1Results = [];

    // Run agents sequentially for Round 1 to manage rate limits
    for (const agent of AGENTS) {
      if (signal?.aborted) {
        console.log('Orchestrator aborted in Round 1');
        return;
      }
      onEvent({ type: 'agent_start', agentId: agent.id, round: 'Round 1', agentName: agent.name });
      
      try {
        const prompt = buildRound1Prompt(agent, idea);
        let accumulatedContent = '';
        
        for await (const chunk of streamGemini(prompt, apiKey)) {
          if (signal?.aborted) {
            console.log('Orchestrator aborted during Round 1 stream');
            return;
          }
          accumulatedContent += chunk;
          onEvent({ 
            type: 'agent_chunk', 
            agentId: agent.id, 
            round: 'Round 1', 
            agentName: agent.name, 
            chunk, 
            content: accumulatedContent 
          });
        }
        
        const response = {
          agentId: agent.id,
          agentName: agent.name,
          round: 'Round 1',
          content: accumulatedContent.trim()
        };

        allResponses.push(response);
        round1Results.push(response);
        onEvent({ type: 'agent_complete', agentId: agent.id, round: 'Round 1', agentName: agent.name, content: response.content });
      } catch (error) {
        onEvent({ type: 'agent_error', agentId: agent.id, round: 'Round 1', error: error.message });
        
        // Return a fallback response so the debate can continue
        const fallback = {
          agentId: agent.id,
          agentName: agent.name,
          round: 'Round 1',
          content: `[${agent.name} encountered an error: ${error.message}. The debate continues without their Round 1 input.]`
        };
        allResponses.push(fallback);
        round1Results.push(fallback);
      }

      // Small delay between Round 1 calls to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    onEvent({ type: 'phase_complete', phase: 'round1' });

    // Small delay between rounds for UX (dramatic effect)
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (signal?.aborted) return;

    // ===== ROUND 2: Cross-Examination =====
    onEvent({ type: 'phase', phase: 'round2', message: 'Round 2: Cross-Examination' });

    const round2Results = [];

    // Run agents sequentially for Round 2 to manage rate limits
    // (15 RPM on free tier — 5 parallel calls in Round 1 used ~5 RPM, 
    //  so we stagger Round 2 to stay safe)
    for (const agent of AGENTS) {
      if (signal?.aborted) {
        console.log('Orchestrator aborted in Round 2');
        return;
      }
      onEvent({ type: 'agent_start', agentId: agent.id, round: 'Round 2', agentName: agent.name });
      
      try {
        const prompt = buildRound2Prompt(agent, idea, round1Results);
        let accumulatedContent = '';
        
        for await (const chunk of streamGemini(prompt, apiKey)) {
          if (signal?.aborted) {
            console.log('Orchestrator aborted during Round 2 stream');
            return;
          }
          accumulatedContent += chunk;
          onEvent({ 
            type: 'agent_chunk', 
            agentId: agent.id, 
            round: 'Round 2', 
            agentName: agent.name, 
            chunk, 
            content: accumulatedContent 
          });
        }
        
        const response = {
          agentId: agent.id,
          agentName: agent.name,
          round: 'Round 2',
          content: accumulatedContent.trim()
        };

        allResponses.push(response);
        round2Results.push(response);
        onEvent({ type: 'agent_complete', agentId: agent.id, round: 'Round 2', agentName: agent.name, content: response.content });
      } catch (error) {
        onEvent({ type: 'agent_error', agentId: agent.id, round: 'Round 2', error: error.message });
        
        const fallback = {
          agentId: agent.id,
          agentName: agent.name,
          round: 'Round 2',
          content: `[${agent.name} encountered an error during rebuttal: ${error.message}]`
        };
        allResponses.push(fallback);
        round2Results.push(fallback);
      }

      // Small delay between Round 2 calls to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    onEvent({ type: 'phase_complete', phase: 'round2' });

    await new Promise(resolve => setTimeout(resolve, 1000));

    if (signal?.aborted) return;

    // ===== VERDICT: Final Synthesis =====
    onEvent({ type: 'phase', phase: 'verdict', message: 'Synthesizing Verdict' });
    onEvent({ type: 'verdict_start' });
    
    try {
      const verdictPrompt = buildVerdictPrompt(idea, allResponses);
      let accumulatedContent = '';
      
      for await (const chunk of streamGemini(verdictPrompt, apiKey)) {
        if (signal?.aborted) {
          console.log('Orchestrator aborted during Verdict stream');
          return;
        }
        accumulatedContent += chunk;
        onEvent({ type: 'verdict_chunk', chunk, content: accumulatedContent });
      }
      
      onEvent({ type: 'verdict_complete', content: accumulatedContent.trim() });
    } catch (error) {
      onEvent({ type: 'verdict_error', error: error.message });
    }

    onEvent({ type: 'complete' });

  } catch (error) {
    onEvent({ type: 'fatal_error', error: error.message });
  }
}
