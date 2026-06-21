'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { AGENTS } from '../lib/agents';
import { supabase, supabaseConnected } from '../lib/supabaseClient';

// Custom hand-drawn SVG icons to avoid external package bloat
const KeyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
);

const TerminalIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
);

const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
);

const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
);

const IdeaIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .6 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
);

// Sample templates for testing
const TEMPLATES = [
  {
    title: "Uber for Private Jets",
    description: "Uber for private jet flights — let middle-class travelers book empty legs on private jets for the price of a commercial first-class ticket."
  },
  {
    title: "AI Healthy Grocery Agent",
    description: "An autonomous agent that reads your fitness goals, checks local store inventories, compares pricing, and automatically orders the healthiest groceries within your budget."
  },
  {
    title: "Clickbait Censoring Extension",
    description: "A browser extension running local AI models to detect and rewrite sensationalized, clickbait news headlines into neutral, objective summaries in real-time."
  }
];

// Helper to parse streamed verdict markdown text into structured fields
function parseVerdictMarkdown(text) {
  const result = {
    verdict: 'PENDING',
    confidence: 0,
    consensus: [],
    contested: [],
    questions: [],
    pivots: [],
    summary: ''
  };

  if (!text) return result;

  // Extract Verdict
  if (text.includes('🟢 GO')) {
    result.verdict = 'GO';
  } else if (text.includes('🟡 PIVOT')) {
    result.verdict = 'PIVOT';
  } else if (text.includes('🔴 KILL')) {
    result.verdict = 'KILL';
  }

  // Extract Confidence Percentage
  const confMatch = text.match(/CONFIDENCE:\s*(\d+)%/i);
  if (confMatch) {
    result.confidence = parseInt(confMatch[1], 10);
  }

  // Split lines to search sections
  const lines = text.split('\n');
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect section headers
    if (line.match(/CONSENSUS POINTS/i)) {
      currentSection = 'consensus';
      continue;
    } else if (line.match(/CONTESTED POINTS/i)) {
      currentSection = 'contested';
      continue;
    } else if (line.match(/CRITICAL QUESTIONS/i)) {
      currentSection = 'questions';
      continue;
    } else if (line.match(/SUGGESTED PIVOTS/i)) {
      currentSection = 'pivots';
      continue;
    } else if (line.match(/ONE-LINE SUMMARY/i)) {
      currentSection = 'summary';
      continue;
    } else if (line.startsWith('#') || line.match(/^[A-Z\s]+:$/)) {
      // General title line
      continue;
    }

    // Capture list items
    const listMatch = line.match(/^[-*•+]\s+(.*)/) || line.match(/^\d+[\.\)]\s+(.*)/);
    if (listMatch) {
      const content = listMatch[1].trim();
      if (currentSection === 'consensus') result.consensus.push(content);
      else if (currentSection === 'contested') result.contested.push(content);
      else if (currentSection === 'questions') result.questions.push(content);
      else if (currentSection === 'pivots') result.pivots.push(content);
    } else if (currentSection === 'summary' && !result.summary) {
      result.summary = line.replace(/^["']|["']$/g, ''); // strip quotes
    }
  }

  return result;
}

// Helper to render bold text by splitting on '**' and stripping '*'
function renderFormattedText(text) {
  if (!text) return null;
  const parts = text.split('**');
  return parts.map((part, index) => {
    const isBold = index % 2 === 1;
    const cleanedPart = part.replace(/\*/g, '');
    if (isBold) {
      return <strong key={index}>{cleanedPart}</strong>;
    }
    return cleanedPart;
  });
}

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [idea, setIdea] = useState('');
  const [statusLogs, setStatusLogs] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | round1 | round2 | verdict | completed
  const [history, setHistory] = useState([]); // List of past feasibility reports
  
  // Auth states
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Agent states
  const [agents, setAgents] = useState(
    AGENTS.reduce((acc, agent) => {
      acc[agent.id] = {
        ...agent,
        status: 'sleeping', // sleeping | analyzing | complete | error
        round1Content: '',
        round2Content: '',
        activeTab: 'round1'
      };
      return acc;
    }, {})
  );

  // Verdict state
  const [verdictText, setVerdictText] = useState('');
  const [verdictParsed, setVerdictParsed] = useState({
    verdict: 'PENDING',
    confidence: 0,
    consensus: [],
    contested: [],
    questions: [],
    pivots: [],
    summary: ''
  });

  const logsEndRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Log handler helper
  const addLog = (sender, text, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setStatusLogs(prev => [...prev, { timestamp, sender, text, type }]);
  };

  // Load API Key and Session / History
  useEffect(() => {
    // 1. Load client-side API Key fallback
    const savedKey = localStorage.getItem('cascade_gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      addLog('System', 'Saved Gemini API key loaded from browser storage.', 'success');
    }

    // 2. Load Supabase Session if connected
    if (supabaseConnected) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setUser(session.user);
          addLog('Auth', `Signed in as ${session.user.email}`, 'success');
          loadCloudHistory(session.user.id);
        } else {
          loadLocalHistory();
        }
      });

      // Listen for auth state changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          setUser(session.user);
          loadCloudHistory(session.user.id);
        } else {
          setUser(null);
          loadLocalHistory();
        }
      });

      return () => subscription.unsubscribe();
    } else {
      addLog('System', 'Supabase offline/unconfigured. Running in Local Storage mode.', 'info');
      loadLocalHistory();
    }
  }, []);

  const loadLocalHistory = () => {
    const savedHistory = localStorage.getItem('cascade_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
        addLog('System', 'Local validation history restored.', 'success');
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  };

  const loadCloudHistory = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('validations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        const formattedHistory = data.map(item => ({
          id: item.id,
          timestamp: new Date(item.created_at).toLocaleString(),
          idea: item.idea_description,
          phase: 'completed',
          agents: item.agent_responses,
          verdictText: item.verdict, // raw text contains final md, let's keep parsed structure
          verdictParsed: {
            verdict: item.verdict,
            confidence: item.confidence,
            consensus: item.consensus,
            contested: item.contested,
            questions: item.questions,
            pivots: item.pivots,
            summary: '' // loaded items parse sections from db
          }
        }));
        setHistory(formattedHistory);
        addLog('System', 'Cloud validation history synced.', 'success');
      }
    } catch (error) {
      addLog('System', `Failed to sync cloud history: ${error.message}. Falling back to local storage.`, 'warning');
      loadLocalHistory();
    }
  };

  // Sync API Key changes to localStorage
  const handleApiKeyChange = (e) => {
    const newKey = e.target.value.trim();
    setApiKey(newKey);
    localStorage.setItem('cascade_gemini_api_key', newKey);
  };

  // Scroll logs container to bottom on updates
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [statusLogs]);

  // Update parsed verdict on text changes
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'completed' && verdictText) {
      setVerdictParsed(parseVerdictMarkdown(verdictText));
    }
  }, [verdictText, phase]);

  // Set selected template
  const applyTemplate = (desc) => {
    if (phase !== 'idle' && phase !== 'completed') return;
    setIdea(desc);
    addLog('System', 'Template applied. Press "Launch Arena Debate" to test.', 'info');
  };

  // Load an item from history
  const loadHistoryItem = (item) => {
    if (phase !== 'idle' && phase !== 'completed') return;
    setIdea(item.idea);
    
    // Load full verdict markdown
    if (item.verdictParsed.summary) {
      // Reconstruct original md format if needed
      setVerdictText(item.verdictText);
      setVerdictParsed(item.verdictParsed);
    } else {
      // Build a basic presentation format from parsed database rows
      let md = `## Overall Verdict: ${item.verdictParsed.verdict}\nCONFIDENCE: ${item.verdictParsed.confidence}%\n\n`;
      md += `### CONSENSUS POINTS\n` + item.verdictParsed.consensus.map(p => `- ${p}`).join('\n') + `\n\n`;
      md += `### CONTESTED POINTS\n` + item.verdictParsed.contested.map(p => `- ${p}`).join('\n') + `\n\n`;
      md += `### CRITICAL QUESTIONS\n` + item.verdictParsed.questions.map(p => `- ${p}`).join('\n') + `\n\n`;
      if (item.verdictParsed.pivots.length) {
        md += `### SUGGESTED PIVOTS\n` + item.verdictParsed.pivots.map(p => `- ${p}`).join('\n') + `\n\n`;
      }
      setVerdictText(md);
      setVerdictParsed(item.verdictParsed);
    }

    setPhase(item.phase);
    setAgents(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(id => {
        updated[id] = {
          ...updated[id],
          status: 'complete',
          round1Content: item.agents[id]?.round1Content || '',
          round2Content: item.agents[id]?.round2Content || '',
          activeTab: 'round1'
        };
      });
      return updated;
    });
    addLog('System', `Loaded validation report for: "${item.idea.slice(0, 30)}..."`, 'success');
  };

  // Remove an item from history
  const deleteHistoryItem = async (e, id) => {
    e.stopPropagation();
    if (supabaseConnected && user) {
      try {
        const { error } = await supabase.from('validations').delete().eq('id', id);
        if (error) throw error;
        setHistory(prev => prev.filter(item => item.id !== id));
        addLog('System', 'Validation report deleted from cloud.', 'info');
      } catch (error) {
        addLog('System', `Failed to delete from cloud: ${error.message}`, 'error');
      }
    } else {
      const updated = history.filter(item => item.id !== id);
      setHistory(updated);
      localStorage.setItem('cascade_history', JSON.stringify(updated));
      addLog('System', 'Validation report removed from history.', 'info');
    }
  };

  // Export report as markdown file
  const exportReport = () => {
    if (!verdictText) return;

    const title = idea.split('\n')[0].slice(0, 50).trim();
    let report = `# Cascade Feasibility Report: ${title}\n\n`;
    report += `**Generated on**: ${new Date().toLocaleString()}\n`;
    report += `**Startup Idea**: *"${idea}"*\n\n`;
    report += `## 🏆 Overall Verdict: ${verdictParsed.verdict === 'GO' ? '🟢 GO' : verdictParsed.verdict === 'PIVOT' ? '🟡 PIVOT' : '🔴 KILL'} (Confidence: ${verdictParsed.confidence}%)\n\n`;

    if (verdictParsed.summary) {
      report += `> "${verdictParsed.summary}"\n\n`;
    }

    report += `### 🤝 Consensus (Points of Agreement)\n`;
    verdictParsed.consensus.forEach(point => {
      report += `- ${point}\n`;
    });
    report += `\n`;

    report += `### ⚡ Contested Risks (Points of Debate)\n`;
    verdictParsed.contested.forEach(point => {
      report += `- ${point}\n`;
    });
    report += `\n`;

    report += `### ❓ Critical Questions to Answer\n`;
    verdictParsed.questions.forEach(point => {
      report += `- ${point}\n`;
    });
    report += `\n`;

    if (verdictParsed.pivots.length > 0) {
      report += `### 🛠️ Suggested Pivots\n`;
      verdictParsed.pivots.forEach(point => {
        report += `- ${point}\n`;
      });
      report += `\n`;
    }

    report += `## 💬 Detailed Agent Critiques\n\n`;

    Object.keys(agents).forEach(id => {
      const a = agents[id];
      report += `### ${a.emoji} ${a.name} — ${a.role}\n\n`;
      report += `#### Round 1: Independent Analysis\n\n`;
      report += `${a.round1Content || 'N/A'}\n\n`;
      report += `#### Round 2: Cross-Examination Rebuttal\n\n`;
      report += `${a.round2Content || 'N/A'}\n\n`;
      report += `---\n\n`;
    });

    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cascade_feasibility_report_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`;
    link.click();
    URL.revokeObjectURL(url);
    addLog('System', 'Feasibility report exported successfully as Markdown.', 'success');
  };

  // Auth Submit handler
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError('Please fill all fields');
      return;
    }

    setAuthError('');
    setAuthLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        addLog('Auth', 'Sign up successful! Please check your email for confirmation.', 'success');
        alert('Registration successful! Check your email for confirmation.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        addLog('Auth', 'Sign in successful!', 'success');
      }
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (error) {
      setAuthError(error.message);
      addLog('Auth', `Authentication failed: ${error.message}`, 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      addLog('Auth', 'Signed out successfully.', 'info');
    } catch (error) {
      addLog('Auth', `Sign out error: ${error.message}`, 'error');
    }
  };

  // Start streaming debate from Next.js server route
  const startDebate = async () => {
    if (!idea.trim()) {
      alert('Please input a startup idea to validate!');
      return;
    }

    // Reset UI state
    setPhase('round1');
    setVerdictText('');
    setVerdictParsed({
      verdict: 'PENDING',
      confidence: 0,
      consensus: [],
      contested: [],
      questions: [],
      pivots: [],
      summary: ''
    });
    
    // Reset all agents
    setAgents(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(id => {
        updated[id].status = 'sleeping';
        updated[id].round1Content = '';
        updated[id].round2Content = '';
        updated[id].activeTab = 'round1';
      });
      return updated;
    });

    setStatusLogs([]);
    addLog('Orchestrator', `Commencing adversarial debate for: "${idea.slice(0, 50)}..."`, 'info');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Send fetch call to App Router SSE endpoint
      const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, apiKey }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `HTTP error! status: ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            try {
              const event = JSON.parse(dataStr);
              handleEvent(event);
            } catch (e) {
              // skip chunk parse errors
            }
          }
        }
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        addLog('System', 'Debate stopped by user.', 'warning');
      } else {
        addLog('System', `SSE Stream Connection Error: ${error.message}`, 'error');
      }
      setPhase('completed');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const stopDebate = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setPhase('completed');
  };

  const retryAgent = async (agentId, round) => {
    if (phase !== 'completed' && phase !== 'idle') return;
    
    // Set agent to analyzing state
    setAgents(prev => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        status: 'analyzing',
        activeTab: round === 'Round 1' ? 'round1' : 'round2'
      }
    }));
    
    addLog('System', `Retrying ${agents[agentId]?.name || 'Agent'} for ${round}...`, 'info');

    // Build the round1Results object required for Round 2 retries
    const round1Results = Object.keys(agents).map(id => ({
      agentId: id,
      agentName: agents[id]?.name || id,
      round: 'Round 1',
      content: agents[id]?.round1Content || ''
    }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_agent',
          agentId,
          round,
          idea,
          apiKey,
          round1Results
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            try {
              const event = JSON.parse(dataStr);
              handleEvent(event);
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        addLog('System', `Retry for ${agents[agentId]?.name || 'Agent'} stopped by user.`, 'warning');
      } else {
        addLog(agents[agentId]?.name || agentId, `Retry failed: ${error.message}`, 'error');
      }
      setAgents(prev => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          status: 'error'
        }
      }));
    } finally {
      abortControllerRef.current = null;
    }
  };

  const retryVerdict = async () => {
    if (phase !== 'completed') return;
    
    setPhase('verdict');
    setVerdictText('');
    setVerdictParsed({
      verdict: 'PENDING',
      confidence: 0,
      consensus: [],
      contested: [],
      questions: [],
      pivots: [],
      summary: ''
    });

    addLog('System', 'Retrying final verdict synthesis...', 'info');

    // Build the responses list
    const allResponses = [];
    Object.keys(agents).forEach(id => {
      allResponses.push({
        agentId: id,
        agentName: agents[id]?.name || id,
        round: 'Round 1',
        content: agents[id]?.round1Content || ''
      });
      allResponses.push({
        agentId: id,
        agentName: agents[id]?.name || id,
        round: 'Round 2',
        content: agents[id]?.round2Content || ''
      });
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_verdict',
          idea,
          apiKey,
          allResponses
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            try {
              const event = JSON.parse(dataStr);
              handleEvent(event);
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        addLog('System', 'Verdict retry stopped by user.', 'warning');
      } else {
        addLog('System', `Verdict retry failed: ${error.message}`, 'error');
      }
      setPhase('completed');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleEvent = (event) => {
    switch (event.type) {
      case 'phase':
        setPhase(event.phase);
        addLog('Orchestrator', `Switching to ${event.message}...`, 'info');
        break;

      case 'agent_start':
        setAgents(prev => ({
          ...prev,
          [event.agentId]: {
            ...prev[event.agentId],
            status: 'analyzing',
            activeTab: event.round === 'Round 1' ? 'round1' : 'round2'
          }
        }));
        addLog(event.agentName, `Activating for ${event.round}...`, 'info');
        break;

      case 'agent_chunk':
        setAgents(prev => ({
          ...prev,
          [event.agentId]: {
            ...prev[event.agentId],
            round1Content: event.round === 'Round 1' ? event.content : prev[event.agentId].round1Content,
            round2Content: event.round === 'Round 2' ? event.content : prev[event.agentId].round2Content
          }
        }));
        break;

      case 'agent_complete':
        setAgents(prev => ({
          ...prev,
          [event.agentId]: {
            ...prev[event.agentId],
            status: 'complete',
            round1Content: event.round === 'Round 1' ? event.content : prev[event.agentId].round1Content,
            round2Content: event.round === 'Round 2' ? event.content : prev[event.agentId].round2Content
          }
        }));
        addLog(event.agentName, `Successfully drafted ${event.round} response.`, 'success');
        break;

      case 'agent_error':
        setAgents(prev => ({
          ...prev,
          [event.agentId]: {
            ...prev[event.agentId],
            status: 'error'
          }
        }));
        addLog(event.agentId, `Error in ${event.round}: ${event.error}`, 'error');
        break;

      case 'verdict_start':
        addLog('Orchestrator', 'Synthesizing final verdict panel...', 'info');
        break;

      case 'verdict_chunk':
        setVerdictText(event.content);
        break;

      case 'verdict_complete':
        setVerdictText(event.content);
        setPhase('completed');
        addLog('Orchestrator', 'Synthesis complete. Arena verdict rendered.', 'success');
        
        // Trigger confetti on GO!
        const finalResult = parseVerdictMarkdown(event.content);
        if (finalResult.verdict === 'GO') {
          confetti({
            particleCount: 150,
            spread: 80,
            origin: { y: 0.6 }
          });
        }

        // Save report logic
        saveCompletedReport(finalResult, event.content);
        break;

      case 'verdict_error':
        addLog('Orchestrator', `Verdict Synthesis Failed: ${event.error}`, 'error');
        setPhase('completed');
        break;

      case 'fatal_error':
        addLog('System', `Critical pipeline error: ${event.error}`, 'error');
        setPhase('completed');
        break;

      default:
        break;
    }
  };

  const saveCompletedReport = async (finalResult, rawText) => {
    const agentsMap = Object.keys(agents).reduce((acc, id) => {
      acc[id] = {
        round1Content: agents[id]?.round1Content || '',
        round2Content: agents[id]?.round2Content || ''
      };
      return acc;
    }, {});

    if (supabaseConnected && user) {
      try {
        const { data, error } = await supabase
          .from('validations')
          .insert({
            user_id: user.id,
            idea_title: idea.split('\n')[0].slice(0, 50).trim(),
            idea_description: idea,
            verdict: finalResult.verdict,
            confidence: finalResult.confidence,
            consensus: finalResult.consensus,
            contested: finalResult.contested,
            questions: finalResult.questions,
            pivots: finalResult.pivots,
            agent_responses: agentsMap
          })
          .select();

        if (error) throw error;
        
        if (data && data[0]) {
          const newItem = {
            id: data[0].id,
            timestamp: new Date(data[0].created_at).toLocaleString(),
            idea: idea,
            phase: 'completed',
            agents: agentsMap,
            verdictText: rawText,
            verdictParsed: finalResult
          };
          setHistory(prev => [newItem, ...prev]);
          addLog('System', 'Validation report saved to Supabase cloud.', 'success');
        }
      } catch (error) {
        addLog('System', `Cloud save failed: ${error.message}. Saving locally instead.`, 'error');
        saveLocalReport(finalResult, rawText, agentsMap);
      }
    } else {
      saveLocalReport(finalResult, rawText, agentsMap);
    }
  };

  const saveLocalReport = (finalResult, rawText, agentsMap) => {
    const newItem = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString(),
      idea: idea,
      phase: 'completed',
      agents: agentsMap,
      verdictText: rawText,
      verdictParsed: finalResult
    };
    setHistory(prevHistory => {
      const updatedHistory = [newItem, ...prevHistory];
      localStorage.setItem('cascade_history', JSON.stringify(updatedHistory));
      return updatedHistory;
    });
    addLog('System', 'Validation report saved to browser storage.', 'success');
  };

  return (
    <div className="app-container">
      {/* App Header Section */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon loader-glow">C</div>
          <div>
            <h1>Cascade</h1>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Multi-Agent Idea Validator</p>
          </div>
          <span>BETA</span>
        </div>

        {/* Database Mode and Cloud Sync */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' }}>
          <div className="user-profile-badge">
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
              {supabaseConnected ? 'DATABASE: ONLINE' : 'DATABASE: OFFLINE'}
            </span>
            {supabaseConnected && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                {user ? (
                  <>
                    <span className="user-email">{user.email}</span>
                    <button className="btn-signout" onClick={handleSignOut}>Sign Out</button>
                  </>
                ) : (
                  <button 
                    className="auth-switch-btn" 
                    onClick={() => {
                      setIsSignUp(false);
                      setAuthError('');
                      setShowAuthModal(true);
                    }}
                  >
                    Cloud Sync Login
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modal Overlay */}
      {showAuthModal && (
        <div className="auth-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="auth-container" onClick={e => e.stopPropagation()}>
            <div className="auth-header">
              <h2>{isSignUp ? 'Create Cloud Account' : 'Cloud Sync Login'}</h2>
              <p>Save and sync your validation reports across devices securely.</p>
            </div>
            
            <form onSubmit={handleAuthSubmit} className="auth-form">
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              {authError && <div style={{ color: 'var(--color-skeptic)', fontSize: '13px', textAlign: 'center' }}>{authError}</div>}

              <button className="btn-primary" type="submit" disabled={authLoading}>
                {authLoading ? 'Please Wait...' : isSignUp ? 'Sign Up' : 'Sign In'}
              </button>
            </form>

            <div className="auth-switch">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}
              <button 
                className="auth-switch-btn"
                onClick={() => {
                  setAuthError('');
                  setIsSignUp(!isSignUp);
                }}
              >
                {isSignUp ? 'Sign In' : 'Sign Up'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace layout */}
      <div className="workspace-grid">
        
        {/* Left Column Controls */}
        <aside className="control-panel">
          <div className="panel-card">
            <h2 className="panel-title"><SparklesIcon /> Validate Idea</h2>
            <textarea
              className="idea-textarea"
              placeholder="Describe your startup idea in detail... (e.g. what is the product, who is it for, how does it make money?)"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={phase !== 'idle' && phase !== 'completed'}
              maxLength={2000}
            />
            <div className="char-counter">{idea.length}/2000</div>
            
            {phase !== 'idle' && phase !== 'completed' ? (
              <button
                className="btn-danger"
                onClick={stopDebate}
                style={{ 
                  background: 'var(--color-skeptic)', 
                  color: '#fff', 
                  border: 'none', 
                  width: '100%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '8px', 
                  padding: '12px', 
                  borderRadius: '8px', 
                  cursor: 'pointer', 
                  fontWeight: 'bold',
                  boxShadow: '0 0 15px rgba(255, 71, 87, 0.4)'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/></svg>
                Stop Debate
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={startDebate}
                disabled={!idea.trim()}
              >
                <PlayIcon /> Launch Arena Debate
              </button>
            )}
          </div>

          {/* Quick-start Templates */}
          <div className="panel-card">
            <h2 className="panel-title"><IdeaIcon /> Sample Ideas</h2>
            <div className="templates-list">
              {TEMPLATES.map((t, idx) => (
                <button
                  key={idx}
                  className="template-btn"
                  onClick={() => applyTemplate(t.description)}
                  disabled={phase !== 'idle' && phase !== 'completed'}
                >
                  <span>{t.title}</span>
                  <span className="template-arrow">→</span>
                </button>
              ))}
            </div>
          </div>

          {/* Saved Reports History */}
          {history.length > 0 && (
            <div className="panel-card">
              <h2 className="panel-title">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                Saved Reports
              </h2>
              <div className="history-list">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="history-item"
                    onClick={() => loadHistoryItem(item)}
                  >
                    <div className="history-meta">
                      <span className="history-idea-text">{item.idea}</span>
                      <span className="history-date">{item.timestamp}</span>
                    </div>
                    <div className="history-badge-row">
                      <span className={`history-badge ${item.verdictParsed.verdict.toLowerCase()}`}>
                        {item.verdictParsed.verdict}
                      </span>
                      <button
                        className="history-delete-btn"
                        onClick={(e) => deleteHistoryItem(e, item.id)}
                        title="Delete report"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Real-time Status Terminal logs */}
          <div className="panel-card">
            <h2 className="panel-title"><TerminalIcon /> Arena Terminal</h2>
            <div className="debate-terminal">
              {statusLogs.length === 0 ? (
                <span className="terminal-line" style={{ color: 'var(--text-muted)' }}>
                  Arena idle. Submitting an idea begins the debate.
                </span>
              ) : (
                statusLogs.map((log, index) => (
                  <div key={index} className="terminal-line">
                    <span className="terminal-timestamp">[{log.timestamp}]</span>
                    <span className={`terminal-${log.type}`}>
                      <strong>{log.sender}:</strong> {log.text}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </aside>

        {/* Right Column Debate Space */}
        <main className="debate-arena">
          
          {/* Phase progress visualizer */}
          <div className="arena-header-status">
            <span style={{ fontWeight: 700, fontSize: '14px', fontFamily: 'var(--font-heading)' }}>
              Debate Arena
            </span>
            <div className="phase-indicators">
              <div className={`phase-indicator ${phase === 'round1' ? 'active' : phase !== 'idle' ? 'completed' : ''}`}>
                <span className="phase-indicator-dot"></span>
                <span>R1: Independent</span>
              </div>
              <div className={`phase-indicator ${phase === 'round2' ? 'active' : (phase === 'verdict' || phase === 'completed') ? 'completed' : ''}`}>
                <span className="phase-indicator-dot"></span>
                <span>R2: Cross-Exam</span>
              </div>
              <div className={`phase-indicator ${phase === 'verdict' ? 'active' : phase === 'completed' ? 'completed' : ''}`}>
                <span className="phase-indicator-dot"></span>
                <span>Synthesis</span>
              </div>
            </div>
          </div>

          {/* Agents Board */}
          <div className="agents-grid">
            {AGENTS.map((agent) => {
              const data = agents?.[agent.id] || {
                status: 'sleeping',
                round1Content: '',
                round2Content: '',
                activeTab: 'round1'
              };
              const isAnalyzing = data.status === 'analyzing';
              const hasR1 = !!data.round1Content;
              const hasR2 = !!data.round2Content;

              return (
                <div key={agent.id} className={`agent-card ${agent.id} ${isAnalyzing ? 'active' : ''}`}>
                  <div className="agent-card-header">
                     <div className="agent-header-top">
                       <div className="agent-avatar">{agent.emoji}</div>
                       <div className="agent-meta">
                         <span className="agent-name">{agent.name}</span>
                         <span className="agent-role">{agent.role}</span>
                       </div>
                     </div>
                     <div className="agent-header-bottom">
                       {(phase === 'completed' || data.status === 'error') && (
                         <button
                           className="btn-retry-icon"
                           onClick={() => retryAgent(agent.id, data.activeTab === 'round1' ? 'Round 1' : 'Round 2')}
                           title={`Retry ${data.activeTab === 'round1' ? 'Round 1' : 'Round 2'}`}
                           style={{
                             background: 'rgba(255,255,255,0.08)',
                             border: '1px solid rgba(255,255,255,0.15)',
                             borderRadius: '4px',
                             color: 'var(--text-muted)',
                             cursor: 'pointer',
                             display: 'flex',
                             alignItems: 'center',
                             justifyContent: 'center',
                             padding: '4px 8px',
                             fontSize: '11px',
                             fontWeight: '600',
                             transition: 'all 0.2s',
                             gap: '4px'
                           }}
                           onMouseEnter={(e) => {
                             e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                             e.currentTarget.style.color = '#fff';
                           }}
                           onMouseLeave={(e) => {
                             e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                             e.currentTarget.style.color = 'var(--text-muted)';
                           }}
                         >
                           <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                           Retry
                         </button>
                       )}
                       <span className={`agent-status-badge ${data.status}`}>
                         {isAnalyzing ? 'Analyzing...' : data.status === 'complete' ? 'Completed' : data.status === 'error' ? 'Error' : 'Sleeping'}
                       </span>
                     </div>
                  </div>

                  <div className="agent-tabs-container">
                    <div className="agent-tabs-header">
                      <button
                        className={`agent-tab-btn ${data.activeTab === 'round1' ? 'active' : ''}`}
                        onClick={() => setAgents(prev => ({
                          ...prev,
                          [agent.id]: { ...prev[agent.id], activeTab: 'round1' }
                        }))}
                        disabled={!hasR1}
                      >
                        Round 1
                      </button>
                      <button
                        className={`agent-tab-btn ${data.activeTab === 'round2' ? 'active' : ''}`}
                        onClick={() => setAgents(prev => ({
                          ...prev,
                          [agent.id]: { ...prev[agent.id], activeTab: 'round2' }
                        }))}
                        disabled={!hasR2}
                      >
                        Round 2 Rebuttal
                      </button>
                    </div>

                    <div className="agent-content-body">
                      {data.activeTab === 'round1' ? (
                        data.round1Content ? (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{renderFormattedText(data.round1Content)}</div>
                        ) : isAnalyzing ? (
                          <div className="typing-indicator">
                            <span className="typing-dot"></span>
                            <span className="typing-dot"></span>
                            <span className="typing-dot"></span>
                          </div>
                        ) : (
                          <div className="agent-empty-state">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            <span>Awaiting first critique...</span>
                          </div>
                        )
                      ) : (
                        data.round2Content ? (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{renderFormattedText(data.round2Content)}</div>
                        ) : isAnalyzing ? (
                          <div className="typing-indicator">
                            <span className="typing-dot"></span>
                            <span className="typing-dot"></span>
                            <span className="typing-dot"></span>
                          </div>
                        ) : (
                          <div className="agent-empty-state">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            <span>Awaiting cross-examination...</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Synthesized Verdict Output Panel */}
          <AnimatePresence>
            {(verdictText || phase === 'verdict' || phase === 'completed') && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 30 }}
                className={`verdict-card ${verdictParsed.verdict.toLowerCase()}`}
              >
                <div className="verdict-header">
                  <div className="verdict-title-section">
                    <h2>Arena Verdict</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Synthesized adversarial output</p>
                  </div>
                  
                  <div className="verdict-badge-wrapper">
                    {/* Export Feasibility Report Button */}
                    {phase === 'completed' && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-secondary" onClick={retryVerdict} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                          Retry Verdict
                        </button>
                        <button className="btn-secondary" onClick={exportReport} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          Export Report
                        </button>
                      </div>
                    )}

                    {/* Confidence Meter */}
                    {verdictParsed.confidence > 0 && (
                      <div className="confidence-gauge-container">
                        <div className="confidence-label">
                          <span>Confidence</span>
                          <span>{verdictParsed.confidence}%</span>
                        </div>
                        <div className="confidence-bar-bg">
                          <div
                            className="confidence-bar-fill"
                            style={{ width: `${verdictParsed.confidence}%` }}
                          ></div>
                        </div>
                      </div>
                    )}

                    <div className={`verdict-badge ${verdictParsed.verdict.toLowerCase()}`}>
                      {verdictParsed.verdict === 'GO' && '🟢 GO'}
                      {verdictParsed.verdict === 'PIVOT' && '🟡 PIVOT'}
                      {verdictParsed.verdict === 'KILL' && '🔴 KILL'}
                      {verdictParsed.verdict === 'PENDING' && '⌛ Synthesizing...'}
                    </div>
                  </div>
                </div>

                {/* Structured Verdict Sections */}
                {verdictText ? (
                  <div className="verdict-body-grid">
                    
                    {verdictParsed.summary && (
                      <div className="verdict-one-liner">
                        "{renderFormattedText(verdictParsed.summary)}"
                      </div>
                    )}

                    {verdictParsed.consensus.length > 0 && (
                      <div className="verdict-section-block">
                        <h3 className="verdict-section-title">Consensus (Agreed Points)</h3>
                        <ul className="verdict-list">
                          {verdictParsed.consensus.map((item, idx) => (
                            <li key={idx}><span>{renderFormattedText(item)}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {verdictParsed.contested.length > 0 && (
                      <div className="verdict-section-block">
                        <h3 className="verdict-section-title">Contested (Key Debated Risks)</h3>
                        <ul className="verdict-list">
                          {verdictParsed.contested.map((item, idx) => (
                            <li key={idx}><span>{renderFormattedText(item)}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {verdictParsed.questions.length > 0 && (
                      <div className="verdict-section-block">
                        <h3 className="verdict-section-title">Critical Questions to Answer</h3>
                        <ul className="verdict-list">
                          {verdictParsed.questions.map((item, idx) => (
                            <li key={idx}><span>{renderFormattedText(item)}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {verdictParsed.pivots.length > 0 && (
                      <div className="verdict-section-block">
                        <h3 className="verdict-section-title">Suggested Pivots</h3>
                        <ul className="verdict-list">
                          {verdictParsed.pivots.map((item, idx) => (
                            <li key={idx}><span>{renderFormattedText(item)}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Fallback to raw streamed text while generating */}
                    {(!verdictParsed.consensus.length && !verdictParsed.contested.length && !verdictParsed.questions.length) && (
                      <div style={{ gridColumn: '1 / -1', whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: 1.6 }}>
                        {renderFormattedText(verdictText)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                    <div className="typing-indicator" style={{ padding: 0 }}>
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                    </div>
                    <span>Synthesizer is compiling debate transcripts...</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

        </main>
      </div>
    </div>
  );
}
