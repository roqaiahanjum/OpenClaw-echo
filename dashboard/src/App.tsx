import { useEffect, useState, useRef } from 'react'
import './App.css'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'Outfit, sans-serif'
});

const MermaidRenderer = ({ chart }: { chart: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && chart) {
      mermaid.render(`mermaid-${Math.random().toString(36).substr(2, 9)}`, chart).then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      }).catch(err => {
        console.error("Mermaid error:", err);
      });
    }
  }, [chart]);
  return <div ref={ref} className="mermaid-container" />;
};

interface SystemStatus {
  mode: string;
  router: {
    gemini: { status: string, details: string };
    ollama: { status: string, details: string };
  };
  memory: {
    sqlite: { status: string, details: string };
    chroma: { status: string, details: string };
  };
  skills: number;
  personality: string;
}

interface ChatMessage {
  text: string;
  isUser: boolean;
}

interface AuditCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  details: string;
}

function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ timestamp: string, content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { text: 'Hello! I am OpenClaw Echo. How can I assist you today?', isUser: false }
  ]);
  const [auditData, setAuditData] = useState<{ score: number, checks: AuditCheck[] } | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [personas, setPersonas] = useState<{ id: string, label: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'audit' | 'insights' | 'scheduler'>('chat');
  const [insightFiles, setInsightFiles] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [newSchedule, setNewSchedule] = useState({ name: '', prompt: '', intervalMin: '60' });
  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error("Backend offline");
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };
  const fetchPersonas = async () => {
    try {
      const res = await fetch('/api/personality');
      const data = await res.json();
      setPersonas(data.available || []);
    } catch (err) {}
  };

  const fetchInsights = async () => {
    try {
      const res = await fetch('/api/sandbox');
      const data = await res.json();
      setInsightFiles(data.files || []);
    } catch (err) {}
  };

  const fetchSchedules = async () => {
    try {
      const res = await fetch('/api/schedules');
      const data = await res.json();
      setSchedules(data.tasks || []);
    } catch (err) {}
  };

  useEffect(() => {
    fetchStatus();
    fetchPersonas();
    fetchInsights();
    const interval = setInterval(fetchStatus, 3000);

    const eventSource = new EventSource('/api/stream');
    eventSource.addEventListener('log', (e) => {
      try {
        const logEntry = JSON.parse(e.data);
        if (logEntry && logEntry.message) {
          setLogs(prev => [...prev, { timestamp: logEntry.time, content: logEntry.message }].slice(-100));
          logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      } catch (err) {}
    });

    return () => {
      clearInterval(interval);
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const message = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { text: message, isUser: true }]);
    setChatLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { text: data.response || 'No response', isUser: false }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { text: 'Connection error. Is the server running?', isUser: false }]);
    }
    setChatLoading(false);
  };

  const handleTestDrive = async () => {
    try {
      await fetch('/api/test-drive', { method: 'POST' });
    } catch (err) {}
  };

  const handlePersonaChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    try {
      await fetch('/api/personality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: e.target.value })
      });
      fetchStatus();
    } catch (err) {}
  };

  const handleAudit = async () => {
    setAuditLoading(true);
    setActiveTab('audit');
    try {
      const res = await fetch('/api/audit');
      const data = await res.json();
      setAuditData(data);
    } catch (err) {}
    setAuditLoading(false);
  };

  const getLogClass = (content: string) => {
    const msg = content.toLowerCase();
    if (msg.includes('[system]')) return 'log-system';
    if (msg.includes('[flow]')) return 'log-flow';
    if (msg.includes('[memory]')) return 'log-memory';
    if (msg.includes('[fatal]') || msg.includes('error')) return 'log-error';
    if (msg.includes('[status]') || msg.includes('[testdrive]')) return 'log-flow';
    if (msg.includes('warning') || msg.includes('⚠️')) return 'log-warn';
    return '';
  };

  const NeuralNode = ({ name, data, icon }: { name: string, data?: { status: string, details: string }, icon: string }) => {
    const isConnected = data?.status === 'connected';
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '1.5rem', background: isConnected ? 'rgba(56,189,248,0.05)' : 'rgba(255,255,255,0.01)', border: isConnected ? '1px solid rgba(56,189,248,0.3)' : '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.8rem', filter: isConnected ? 'drop-shadow(0 0 10px rgba(56,189,248,0.5))' : 'grayscale(1)' }}>{icon}</div>
        <strong style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>{name}</strong>
        <div style={{ fontSize: '0.7rem', opacity: isConnected ? 0.9 : 0.5, color: isConnected ? 'var(--primary)' : 'var(--text-secondary)' }}>
          {isConnected ? '● ACTIVE' : '○ OFFLINE'}
        </div>
      </div>
    );
  };

  const auditColor = (s: string) => s === 'pass' ? 'var(--success)' : s === 'warn' ? 'var(--warn)' : 'var(--error)';

  return (
    <>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <header style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1440px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <div style={{ width: '32px', height: '32px', background: 'linear-gradient(135deg, #38bdf8, #818cf8)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>Ω</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.5px', background: 'linear-gradient(to right, #f8fafc, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            OPENCLAW <span style={{ color: 'var(--primary)', WebkitTextFillColor: 'var(--primary)' }}>ECHO</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {auditData && (
            <div className="status-badge" style={{ borderColor: auditData.score > 80 ? 'var(--success)' : 'var(--warn)', color: auditData.score > 80 ? 'var(--success)' : 'var(--warn)' }}>
              CORE INTEGRITY: {auditData.score}%
            </div>
          )}
          <div className="status-badge" style={{ borderColor: error ? 'var(--error)' : 'var(--success)', color: error ? 'var(--error)' : 'white' }}>
            {!error && <div className="pulse" />}
            {error ? 'SENTINEL ALERT' : 'ACTIVE'}
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        {/* Neural Connectivity */}
        <div className="glass-panel col-span-8">
          <h3>Neural Connectivity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.2rem' }}>
            <NeuralNode name="Cloud Brain" icon="🧠" data={status?.router?.gemini} />
            <NeuralNode name="Memory Vault" icon="🔒" data={status?.memory?.sqlite} />
            <NeuralNode name="Knowledge Base" icon="📚" data={status?.memory?.chroma} />
            <NeuralNode name="Edge Intelligence" icon="🛰️" data={status?.router?.ollama} />
          </div>
        </div>

        {/* Agent Performance */}
        <div className="glass-panel col-span-4" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3>Performance Hub</h3>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="text-muted">Active Persona</span>
              <select onChange={handlePersonaChange} value={status?.personality} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '10px', padding: '0.4rem 0.8rem', cursor: 'pointer', outline: 'none', fontSize: '0.85rem' }}>
                {personas.length > 0 ? personas.map(p => (
                  <option key={p.id} value={p.id} style={{ background: '#0f172a' }}>{p.label}</option>
                )) : <option style={{ background: '#0f172a' }}>{status?.personality || 'Standard Agent'}</option>}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Skill Registry</span>
              <strong style={{ color: 'var(--primary)' }}>{status?.skills || 0} Autonomous Tools</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Neural Mode</span>
              <strong style={{ color: 'var(--accent)' }}>{status?.mode?.toUpperCase() || 'POLLING'}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1.5rem' }}>
            <button className="primary-btn" onClick={handleTestDrive} style={{ flex: 1, padding: '1rem', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #38bdf8, #818cf8)', color: 'white', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 15px rgba(56,189,248,0.2)' }}>
              🚀 TEST DRIVE
            </button>
            <button onClick={handleAudit} disabled={auditLoading} style={{ flex: 1, padding: '1rem', borderRadius: '14px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
              {auditLoading ? '⏳ AUDITING...' : '🛡️ SENTINEL'}
            </button>
          </div>
        </div>

        {/* Bottom Panels */}
        <div className="glass-panel col-span-8" style={{ display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem', flexWrap: 'wrap' }}>
            {(['chat', 'audit', 'insights', 'scheduler'] as const).map(tab => (
              <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'insights') fetchInsights(); if (tab === 'scheduler') fetchSchedules(); }} style={{ background: 'none', border: 'none', color: activeTab === tab ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700, position: 'relative', padding: '0.5rem 0' }}>
                {tab === 'chat' ? '⚡ CHAT' : tab === 'audit' ? '🛡️ AUDIT' : tab === 'insights' ? '📊 INSIGHTS' : '⏰ SCHEDULER'}
                {activeTab === tab && <div style={{ position: 'absolute', bottom: '-1px', left: 0, right: 0, height: '2px', background: 'var(--primary)', boxShadow: '0 0 10px var(--primary)' }} />}
              </button>
            ))}
          </div>

          {activeTab === 'chat' && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem', marginBottom: '1.5rem', scrollbarWidth: 'thin' }}>
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.isUser ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '85%', padding: '1rem 1.4rem', borderRadius: msg.isUser ? '20px 20px 4px 20px' : '20px 20px 20px 4px', background: msg.isUser ? 'linear-gradient(135deg, #38bdf8, #818cf8)' : 'rgba(255,255,255,0.04)', border: msg.isUser ? 'none' : '1px solid var(--glass-border)', fontSize: '0.95rem', lineHeight: 1.6, boxShadow: msg.isUser ? '0 10px 20px rgba(56,189,248,0.2)' : 'none', position: 'relative' }}>
                      {msg.text.includes('```mermaid') ? (
                        <>
                          <div style={{ marginBottom: '1rem' }}>{msg.text.split('```mermaid')[0]}</div>
                          <MermaidRenderer chart={msg.text.split('```mermaid')[1].split('```')[0].trim()} />
                          <div>{msg.text.split('```')[2]}</div>
                        </>
                      ) : (
                        msg.text
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ padding: '1rem 1.4rem', borderRadius: '20px 20px 20px 4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                      <div className="pulse" style={{ display: 'inline-block', marginRight: '8px' }} /> Processing Neural Sequence...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: 'flex', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '18px', border: '1px solid var(--glass-border)' }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleChat()}
                  placeholder="Ask the Swarm anything..."
                  disabled={chatLoading}
                  style={{ flex: 1, padding: '1rem 1.5rem', borderRadius: '14px', border: 'none', background: 'transparent', color: 'white', fontFamily: 'inherit', outline: 'none', fontSize: '1rem' }}
                />
                <button disabled={chatLoading} onClick={handleChat} style={{ padding: '0 2rem', borderRadius: '14px', border: 'none', background: 'var(--primary)', color: '#0c1222', fontWeight: 800, cursor: 'pointer', transition: 'transform 0.2s' }}>
                  SEND
                </button>
              </div>
            </>
          )}

          {activeTab === 'audit' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
              {!auditData && !auditLoading ? (
                <div style={{ textAlign: 'center', padding: '4rem', opacity: 0.5 }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛡️</div>
                  Run a Sentinel Audit to verify system integrity.
                </div>
              ) : auditLoading ? (
                <div style={{ textAlign: 'center', padding: '4rem' }}>
                  <div className="pulse" style={{ width: '40px', height: '40px', margin: '0 auto 1.5rem' }} />
                  Scanning neural bridges...
                </div>
              ) : auditData ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  {auditData.checks.map((check, i) => (
                    <div key={i} className="glass-panel" style={{ padding: '1.2rem', background: 'rgba(255,255,255,0.01)', borderLeft: `4px solid ${auditColor(check.status)}`, borderRadius: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{check.name}</strong>
                        <span style={{ fontSize: '0.7rem', color: auditColor(check.status), fontWeight: 800 }}>{check.status.toUpperCase()}</span>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{check.details}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {activeTab === 'insights' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                {insightFiles.filter(f => f.endsWith('.svg') || f.endsWith('.png') || f.endsWith('.jpg')).map((file, i) => (
                  <div key={i} className="glass-panel" style={{ padding: '1rem', border: '1px solid var(--glass-border)', overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file}</div>
                    <img src={`/api/sandbox/raw?file=${file}`} alt={file} style={{ width: '100%', borderRadius: '12px', background: 'rgba(255,255,255,0.02)' }} />
                  </div>
                ))}
                {insightFiles.length === 0 && <div style={{ textAlign: 'center', gridColumn: '1/-1', padding: '4rem', opacity: 0.5 }}>No insights generated yet. Ask me to create a chart!</div>}
              </div>
            </div>
          )}

          {activeTab === 'scheduler' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
              <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem', fontWeight: 600 }}>Create Scheduled Task</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
                  <input placeholder="Task Name" value={newSchedule.name} onChange={e => setNewSchedule(p => ({ ...p, name: e.target.value }))} style={{ padding: '0.8rem', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)', color: 'white', outline: 'none' }} />
                  <input placeholder="Interval (minutes)" type="number" value={newSchedule.intervalMin} onChange={e => setNewSchedule(p => ({ ...p, intervalMin: e.target.value }))} style={{ padding: '0.8rem', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)', color: 'white', outline: 'none' }} />
                </div>
                <input placeholder="AI Prompt (what should the agent do?)" value={newSchedule.prompt} onChange={e => setNewSchedule(p => ({ ...p, prompt: e.target.value }))} style={{ width: '100%', padding: '0.8rem', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)', color: 'white', outline: 'none', marginBottom: '1rem' }} />
                <button onClick={async () => {
                  if (!newSchedule.name || !newSchedule.prompt) return;
                  await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newSchedule.name, prompt: newSchedule.prompt, intervalMs: parseInt(newSchedule.intervalMin) * 60000, description: '' }) });
                  setNewSchedule({ name: '', prompt: '', intervalMin: '60' });
                  fetchSchedules();
                }} style={{ padding: '0.8rem 2rem', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg, #38bdf8, #818cf8)', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
                  ➕ Schedule Task
                </button>
              </div>
              {schedules.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', opacity: 0.5 }}>⏰ No scheduled tasks yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {schedules.map((task: any) => (
                    <div key={task.id} className="glass-panel" style={{ padding: '1.2rem', borderLeft: `4px solid ${task.enabled ? 'var(--success)' : 'var(--text-secondary)'}`, borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{task.name}</strong>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>Every {Math.round(task.intervalMs / 60000)} min • {task.enabled ? '🟢 Active' : '⚪ Paused'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem', opacity: 0.7 }}>{task.prompt.slice(0, 80)}...</div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={async () => { await fetch(`/api/schedules/${task.id}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !task.enabled }) }); fetchSchedules(); }} style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)', color: 'white', cursor: 'pointer', fontSize: '0.8rem' }}>
                          {task.enabled ? '⏸ Pause' : '▶ Resume'}
                        </button>
                        <button onClick={async () => { await fetch(`/api/schedules/${task.id}`, { method: 'DELETE' }); fetchSchedules(); }} style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--error)', background: 'rgba(244,63,94,0.1)', color: 'var(--error)', cursor: 'pointer', fontSize: '0.8rem' }}>
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Telemetry */}
        <div className="glass-panel col-span-4" style={{ display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
          <h3>Neural Telemetry</h3>
          <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.4)', padding: '1.2rem', borderRadius: '16px', fontFamily: '"Fira Code", monospace', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.05)' }}>
            {logs.length === 0
              ? <div className="text-muted" style={{ textAlign: 'center', marginTop: '3rem', opacity: 0.4 }}>Awaiting neural signal...</div>
              : logs.map((log, i) => (
                <div key={i} style={{ marginBottom: '0.6rem', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.6rem', lineHeight: 1.4 }}>
                  <span style={{ opacity: 0.4, marginRight: '0.8rem', fontSize: '0.7rem' }}>{log.timestamp}</span>
                  <span className={getLogClass(log.content)}>{log.content}</span>
                </div>
              ))
            }
            <div ref={logEndRef} />
          </div>
        </div>
      </main>
    </>
  );
}

export default App;
