import { useEffect, useState } from 'react'
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

function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{timestamp: string, content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      // Proxied to backend via vite.config.ts
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error("Backend offline");
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    
    // Server-Sent Events setup
    const eventSource = new EventSource('/api/stream');
    
    eventSource.addEventListener('log', (e) => {
      try {
        const logEntry = JSON.parse(e.data); // { time, message }
        if (logEntry && logEntry.message) {
          setLogs(prev => [...prev, { timestamp: logEntry.time, content: logEntry.message }].slice(-100));
        }
      } catch (err) {}
    });

    return () => {
      clearInterval(interval);
      eventSource.close();
    };
  }, []);

  const NeuralNode = ({ name, data, icon }: { name: string, data?: {status: string, details: string}, icon: string }) => {
    const isConnected = data?.status === 'connected';
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem', background: isConnected ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(129, 140, 248, 0.1))' : 'rgba(255,255,255,0.02)', borderRadius: '16px', border: isConnected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{icon}</div>
        <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{name}</strong>
        <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>{data?.details || "Checking..."}</span>
      </div>
    );
  };

  const handleChat = async () => {
    if (!chatInput) return;
    setChatLoading(true);
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatInput })
      });
      setChatInput('');
    } catch(err) {}
    setChatLoading(false);
  }

  return (
    <>
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      
      <header style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 600, background: 'linear-gradient(to right, #38bdf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          OPENCLAW ECHO
        </div>
        <div className="status-badge" style={{ borderColor: error ? 'var(--error)' : 'var(--success)', color: error ? 'var(--error)' : 'white' }}>
          {!error && <div className="pulse"></div>}
          {error ? "SYSTEM DOWN" : "SYSTEM OPERATIONAL"}
        </div>
      </header>

      <main className="dashboard-grid">
        <div className="glass-panel col-span-8">
          <h3 className="text-indigo">Neural Connectivity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <NeuralNode name="Google Gemini" icon="🤖" data={status?.router?.gemini} />
            <NeuralNode name="SQLite DB" icon="💾" data={status?.memory?.sqlite} />
            <NeuralNode name="Vector Core" icon="🌀" data={status?.memory?.chroma} />
            <NeuralNode name="Ollama Edge" icon="🦙" data={status?.router?.ollama} />
          </div>
        </div>

        <div className="glass-panel col-span-4" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="text-cyan">Agent Performance</h3>
          
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Active Skills</span>
              <strong>{status?.skills || 0} Tools Enabled</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Agent Persona</span>
              <strong style={{ color: '#c084fc', textTransform: 'uppercase' }}>{status?.personality || "Loading..."}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-muted">Server Mode</span>
              <strong>{status?.mode?.toUpperCase() || "UNKNOWN"}</strong>
            </div>
          </div>
          
          <button style={{ width: '100%', padding: '1rem', marginTop: '1rem', borderRadius: '12px', border: 'none', background: 'linear-gradient(to right, #38bdf8, #818cf8)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
            🚀 Test Connectivity
          </button>
        </div>

        <div className="glass-panel col-span-12" style={{ maxHeight: '400px', display: 'flex', flexDirection: 'column' }}>
           <h3 className="text-purple">Live Telemetry</h3>
           <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
             {logs.length === 0 ? <p className="text-muted" style={{textAlign: 'center', marginTop: '2rem'}}>Awaiting LangChain engine logs...</p> : null}
             {logs.map((log, i) => (
               <div key={i} style={{ marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                 <span style={{ color: 'var(--accent)', marginRight: '1rem' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                 <span style={{ color: log.content.includes("Error") ? 'var(--error)' : 'var(--text-primary)' }}>{log.content}</span>
               </div>
             ))}
           </div>
           
           {/* WebChat Interface */}
           <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
             <input 
               value={chatInput}
               onChange={(e) => setChatInput(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && handleChat()}
               placeholder="Chat with OpenClaw Echo internally..."
               style={{ flex: 1, padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)', background: 'var(--glass)', color: 'white', fontFamily: 'inherit' }}
               disabled={chatLoading}
             />
             <button disabled={chatLoading} onClick={handleChat} style={{ padding: '0 2rem', borderRadius: '12px', border: 'none', background: 'linear-gradient(to right, #4ade80, #38bdf8)', color: '#0f172a', fontWeight: 'bold', cursor: 'pointer' }}>
               {chatLoading ? 'WAIT' : 'SEND'}
             </button>
           </div>
        </div>
      </main>
    </>
  )
}

export default App
