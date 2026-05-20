import React, { useState, useEffect } from 'react';
import GuardView from './components/GuardView';
import MonitorView from './components/MonitorView';
import SplashScreen from './components/SplashScreen';
import { ShieldAlert, MonitorCheck, ImagePlus, UserCircle2, Key } from 'lucide-react';
import { io } from 'socket.io-client';
import { getLocalData, setLocalData } from './utils/db';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001";

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [session, setSession] = useState(null);
  const [licenseInfo, setLicenseInfo] = useState({ type: 'free', expires: null });
  const [showPricing, setShowPricing] = useState(false);
  
  // Login State
  const [role, setRole] = useState('guard');
  const [username, setUsername] = useState(localStorage.getItem('mfx_username') || '');
  const [avatar, setAvatar] = useState(localStorage.getItem('mfx_avatar') || '');
  
  const [mode, setMode] = useState('join'); // 'join' or 'create'
  const [channel, setChannel] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  
  useEffect(() => {
    // Load license on mount
    const loadLicense = async () => {
      const data = await getLocalData('mfx_license');
      if (data) setLicenseInfo(data);
    };
    loadLicense();
  }, []);

  // Handle Avatar Upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      // Basic compression using canvas
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 150;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // Compress to 60%
        setAvatar(dataUrl);
        localStorage.setItem('mfx_avatar', dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    setErrorMsg('');
    if (!username.trim() || !channel.trim()) return;

    localStorage.setItem('mfx_username', username);
    setIsConnecting(true);

    const socket = io(SOCKET_SERVER_URL, {
      timeout: 5000,
      reconnection: false
    });

    const timeoutId = setTimeout(() => {
      setErrorMsg(`Límite de tiempo de conexión excedido para el servidor en ${SOCKET_SERVER_URL}. El servidor podría estar en "cold start" (dormido) en Render, apagado, o el URL de socket no estar inyectado correctamente en el Frontend.`);
      setIsConnecting(false);
      socket.disconnect();
    }, 5000);

    socket.on('connect_error', (err) => {
      clearTimeout(timeoutId);
      setErrorMsg(`Error de conexión con el servidor en ${SOCKET_SERVER_URL}: ${err.message}. Asegúrate de que la variable de entorno VITE_SOCKET_SERVER_URL en Render sea la correcta.`);
      setIsConnecting(false);
      socket.disconnect();
    });

    if (mode === 'create') {
      socket.emit('create_channel', { channel, password }, (res) => {
        clearTimeout(timeoutId);
        setIsConnecting(false);
        if (res.success) {
          socket.disconnect(); 
          setSession({ role, username, channel, password, avatar, license: licenseInfo });
        } else {
          setErrorMsg(res.message);
          socket.disconnect();
        }
      });
    } else {
      socket.emit('join_channel', { role, channel, username, password, avatar }, (res) => {
        clearTimeout(timeoutId);
        setIsConnecting(false);
        if (res.success) {
          socket.disconnect();
          setSession({ role, username, channel, password, avatar, license: licenseInfo });
        } else {
          setErrorMsg(res.message);
          socket.disconnect();
        }
      });
    }
  };

  const handleLogout = () => {
    setSession(null);
  };

  const handleSimulatePremium = async () => {
    const data = { type: 'premium', expires: new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString() };
    await setLocalData('mfx_license', data);
    setLicenseInfo(data);
    
    // Update session immediately so views re-render
    if (session) setSession({ ...session, license: data });
    setShowPricing(false);
    alert('Licencia Premium simulada. Vigencia: ' + data.expires);
  };

  const PricingModal = () => (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="glass-panel" style={{ padding: '30px', maxWidth: '400px', width: '90%', textAlign: 'center', position: 'relative' }}>
        <button onClick={() => setShowPricing(false)} style={{ position: 'absolute', top: '10px', right: '15px', background: 'transparent', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>×</button>
        
        <h2 style={{ color: 'var(--neon-cyan)', marginBottom: '5px' }}>Mejora tu Plan</h2>
        <p className="text-secondary" style={{ fontSize: '14px', marginBottom: '20px' }}>Ecosistema Master FixPc</p>
        
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '15px', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--border-glass)' }}>
          <h3 style={{ color: '#fff', margin: '0 0 10px 0' }}>MFX Core PRO</h3>
          <ul style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.6', margin: '0 0 15px 0', paddingLeft: '20px' }}>
            <li>Mensajes de voz Ilimitados</li>
            <li>Sin interrupciones publicitarias</li>
            <li>Soporte Técnico Especializado</li>
            <li>Creación de múltiples salas privadas</li>
          </ul>
          <a href="https://masterfixpc.com" target="_blank" rel="noreferrer" style={{ display: 'block', background: 'var(--neon-cyan)', color: '#000', padding: '10px', borderRadius: '5px', textDecoration: 'none', fontWeight: 'bold' }}>
            IR A PASARELA DE PAGOS
          </a>
        </div>
        
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '15px 0' }}>O contáctanos vía WhatsApp:<br/><strong>+57 300 000 0000</strong></p>
        
        {/* Developer Tool */}
        <button onClick={handleSimulatePremium} style={{ background: 'transparent', border: '1px dashed var(--neon-green)', color: 'var(--neon-green)', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', marginTop: '10px' }}>
          [Dev] Simular Compra
        </button>
      </div>
    </div>
  );

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (session) {
    return (
      <>
        {showPricing && <PricingModal />}
        {session.role === 'monitor' ? (
          <MonitorView session={session} onLogout={handleLogout} onUpgrade={() => setShowPricing(true)} />
        ) : (
          <GuardView session={session} onLogout={handleLogout} onUpgrade={() => setShowPricing(true)} />
        )}
      </>
    );
  }

  return (
    <div className="flex-center flex-column" style={{ minHeight: '100vh', padding: '20px' }}>
      <div className="glass-panel" style={{ padding: '30px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <ShieldAlert className="text-neon-cyan" size={32} />
          <span>MFX <span className="text-neon-cyan">Security</span></span>
        </h1>
        <p className="text-secondary" style={{ marginBottom: '15px', fontSize: '14px' }}>Centro de Comunicaciones Tácticas</p>
        
        {licenseInfo.type === 'premium' ? (
          <div style={{ marginBottom: '20px', fontSize: '12px', color: 'var(--neon-green)', border: '1px solid var(--neon-green)', padding: '4px', borderRadius: '4px', background: 'rgba(57, 255, 20, 0.1)' }}>
            ✓ VERSIÓN PREMIUM (Expira: {licenseInfo.expires})
          </div>
        ) : (
          <div style={{ marginBottom: '20px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            VERSIÓN FREE (Con Anuncios y Límite Diario)
            <button type="button" onClick={() => setShowPricing(true)} style={{ marginLeft: '10px', background: 'transparent', border: '1px solid var(--neon-cyan)', color: 'var(--neon-cyan)', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', padding: '2px 5px' }}>
              MEJORAR PLAN
            </button>
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* Perfil */}
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '10px' }}>
            <label style={{ cursor: 'pointer', position: 'relative' }}>
              {avatar ? (
                <img src={avatar} alt="Avatar" style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--neon-cyan)' }} />
              ) : (
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', border: '2px dashed var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UserCircle2 size={32} color="var(--text-secondary)" />
                </div>
              )}
              <div style={{ position: 'absolute', bottom: '-5px', right: '-5px', background: 'var(--panel-bg)', borderRadius: '50%', padding: '4px' }}>
                <ImagePlus size={14} color="var(--neon-cyan)" />
              </div>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </label>
            <input 
              type="text" 
              placeholder="Nickname / Indicativo" 
              className="input-glass"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{ flex: 1 }}
            />
          </div>

          {/* Rol */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button 
              type="button"
              className={`input-glass ${role === 'guard' ? 'active' : ''}`}
              style={{ borderColor: role === 'guard' ? 'var(--neon-cyan)' : 'var(--border-glass)', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '5px' }}
              onClick={() => setRole('guard')}
            >
              <ShieldAlert size={18} /> Vigilante
            </button>
            <button 
              type="button"
              className={`input-glass ${role === 'monitor' ? 'active' : ''}`}
              style={{ borderColor: role === 'monitor' ? 'var(--neon-blue)' : 'var(--border-glass)', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '5px' }}
              onClick={() => setRole('monitor')}
            >
              <MonitorCheck size={18} /> Monitor
            </button>
          </div>

          {/* Modo de Canal */}
          <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)', marginBottom: '5px' }}>
            <button 
              type="button"
              style={{ flex: 1, padding: '8px', background: mode === 'join' ? 'rgba(0, 240, 255, 0.2)' : 'transparent', border: 'none', color: mode === 'join' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={() => setMode('join')}
            >Unirse</button>
            <button 
              type="button"
              style={{ flex: 1, padding: '8px', background: mode === 'create' ? 'rgba(0, 240, 255, 0.2)' : 'transparent', border: 'none', color: mode === 'create' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={() => {
                setMode('create');
                setChannel(Math.random().toString(36).substring(2, 8).toUpperCase());
                setPassword(Math.floor(1000 + Math.random() * 9000).toString());
              }}
            >Crear Nuevo</button>
          </div>

          {/* Datos del Canal */}
          <input 
            type="text" 
            placeholder="ID del Canal (Ej. PARQ-01)" 
            className="input-glass"
            value={channel}
            onChange={(e) => setChannel(e.target.value.toUpperCase())}
            required
            readOnly={mode === 'create'}
          />
          
          <input 
            type="text" 
            placeholder="Clave de Acceso (Opcional)" 
            className="input-glass"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            readOnly={mode === 'create'}
          />

          {errorMsg && <p style={{ color: 'var(--neon-red)', fontSize: '14px', margin: '5px 0' }}>{errorMsg}</p>}

          <button type="submit" className="btn-primary" style={{ marginTop: '10px' }} disabled={isConnecting}>
            {isConnecting ? 'CONECTANDO...' : (mode === 'create' ? 'CREAR Y CONECTAR' : 'CONECTAR')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
