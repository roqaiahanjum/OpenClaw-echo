import { useEffect, useState, useRef } from 'react'
import './App.css'

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
  const [activeTab, setActiveTab] = useState<'chat' | 'audit'>('chat');
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

  useEffect(() => {
    fetchStatus();
    fetchPersonas();
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

  const NeuralNode = ({ name, data, icon }: { name: string, data?: { status: string, details: string }, icon: string }) => {
    const isConnected = data?.status === 'connected';
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem', background: isConnected ? 'linear-gradient(135deg, rgba(56,189,248,0.1), rgba(129,140,248,0.1))' : 'rgba(255,255,255,0.02)', borderRadius: '16px', border: isConnected ? '1px solid rgba(56,189,248,0.3)' : '1px solid rgba(255,255,255,0.1)', transition: 'all 0.3s' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{icon}</div>
        <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{name}</strong>
        <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>{data?.details || 'Checking...'}</span>
      </div>
    );
  };

  const auditColor = (s: string) => s === 'pass' ? 'var(--success)' : s === 'warn' ? 'var(--secondary)' : 'var(--error)';

  return (
    <>
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <header style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 600, background: 'linear-gradient(to right, #38bdf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          OPENCLAW ECHO
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {auditData && (
            <div className="status-badge" style={{ borderColor: 'var(--secondary)', color: 'var(--secondary)' }}>
              SENTINEL: {auditData.score}%
            </div>
          )}
          <div className="status-badge" style={{ borderColor: error ? 'var(--error)' : 'var(--success)', color: error ? 'var(--error)' : 'white' }}>
            {!error && <div className="pulse" />}
            {error ? 'SYSTEM DOWN' : 'SYSTEM OPERATIONAL'}
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        {/* Neural Connectivity */}
        <div className="glass-panel col-span-8">
          <h3 className="text-indigo">Neural Connectivity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <NeuralNode name="Google Gemini" icon="🤖" data={status?.router?.gemini} />
            <NeuralNode name="SQLite DB" icon="💾" data={status?.memory?.sqlite} />
            <NeuralNode name="Vector Core" icon="🌀" data={status?.memory?.chroma} />
            <NeuralNode name="Ollama Edge" icon="🦙" data={status?.router?.ollama} />
          </div>
        </div>

        {/* Agent Performance */}
        <div className="glass-panel col-span-4" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="text-cyan">Agent Performance</h3>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="text-muted">Agent Persona</span>
              <select onChange={handlePersonaChange} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '8px', padding: '0.3rem 0.5rem', cursor: 'pointer', outline: 'none' }}>
                {personas.length > 0 ? personas.map(p => (
                  <option key={p.id} value={p.id} style={{ background: '#0f172a' }}>{p.label}</option>
                )) : <option style={{ background: '#0f172a' }}>{status?.personality || 'Standard Agent'}</option>}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Active Skills</span>
              <strong>{status?.skills || 0} Tools</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Server Mode</span>
              <strong>{status?.mode?.toUpperCase() || 'UNKNOWN'}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={handleTestDrive} style={{ flex: 1, padding: '0.8rem', borderRadius: '12px', border: 'none', background: 'linear-gradient(to right, #38bdf8, #818cf8)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
              🚀 Test Drive
            </button>
            <button onClick={handleAudit} disabled={auditLoading} style={{ flex: 1, padding: '0.8rem', borderRadius: '12px', border: '1px solid var(--glass-border)', background: 'var(--glass)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
              {auditLoading ? '⏳ Auditing...' : '🛡️ Sentinel Audit'}
            </button>
          </div>
        </div>

        {/* Bottom Panels: Tabs for Chat vs Audit */}
        <div className="glass-panel col-span-8" style={{ display: 'flex', flexDirection: 'column', minHeight: '420px' }}>
          {/* Tab Switcher */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            {(['chat', 'audit'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '0.4rem 1rem', borderRadius: '99px', border: '1px solid', borderColor: activeTab === tab ? 'var(--primary)' : 'var(--glass-border)', background: activeTab === tab ? 'rgba(56,189,248,0.1)' : 'transparent', color: activeTab === tab ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                {tab === 'chat' ? '💬 WebChat' : '🛡️ Sentinel Audit'}
              </button>
            ))}
          </div>

          {/* Chat Panel */}
          {activeTab === 'chat' && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.8rem', padding: '0.5rem', marginBottom: '1rem' }}>
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.isUser ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '80%', padding: '0.8rem 1.2rem', borderRadius: msg.isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: msg.isUser ? 'linear-gradient(to right, #38bdf8, #818cf8)' : 'rgba(255,255,255,0.07)', fontSize: '0.9rem', lineHeight: 1.5, boxShadow: msg.isUser ? '0 4px 15px rgba(56,189,248,0.3)' : 'none' }}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ padding: '0.8rem 1.2rem', borderRadius: '18px 18px 18px 4px', background: 'rgba(255,255,255,0.07)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      ⏳ Thinking...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: 'flex', gap: '0.8rem' }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleChat()}
                  placeholder="Message OpenClaw Echo..."
                  disabled={chatLoading}
                  style={{ flex: 1, padding: '1rem 1.2rem', borderRadius: '12px', border: '1px solid var(--glass-border)', background: 'var(--glass)', color: 'white', fontFamily: 'inherit', outline: 'none', fontSize: '0.9rem' }}
                />
                <button disabled={chatLoading} onClick={handleChat} style={{ padding: '0 1.5rem', borderRadius: '12px', border: 'none', background: 'linear-gradient(to right, #4ade80, #38bdf8)', color: '#0f172a', fontWeight: 700, cursor: chatLoading ? 'not-allowed' : 'pointer' }}>
                  SEND
                </button>
              </div>
            </>
          )}

          {/* Audit Panel */}
          {activeTab === 'audit' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {!auditData && !auditLoading && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  Click "🛡️ Sentinel Audit" to run a full system health check.
                </div>
              )}
              {auditLoading && <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Running audit...</div>}
              {auditData && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.8rem' }}>
                  {auditData.checks.map((check, i) => (
                    <div key={i} style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', borderLeft: `3px solid ${auditColor(check.status)}` }}>
                      <strong style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>{check.name}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{check.details}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Telemetry */}
        <div className="glass-panel col-span-4" style={{ display: 'flex', flexDirection: 'column', minHeight: '420px' }}>
          <h3 className="text-purple">Live Telemetry</h3>
          <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '12px', fontFamily: 'monospace', fontSize: '0.8rem' }}>
            {logs.length === 0
              ? <p className="text-muted" style={{ textAlign: 'center', marginTop: '2rem' }}>Awaiting engine logs...</p>
              : logs.map((log, i) => (
                <div key={i} style={{ marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.4rem' }}>
                  <span style={{ color: 'var(--accent)', marginRight: '0.5rem' }}>[{log.timestamp}]</span>
                  <span style={{ color: log.content.toLowerCase().includes('error') ? 'var(--error)' : 'var(--text-primary)' }}>{log.content}</span>
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
