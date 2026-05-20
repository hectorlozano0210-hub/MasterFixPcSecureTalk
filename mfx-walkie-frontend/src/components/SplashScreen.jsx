import React, { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';

export default function SplashScreen({ onFinish }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 3500); // 3.5 seconds splash screen
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      justifyContent: 'center', 
      alignItems: 'center', 
      backgroundColor: '#0a0a0c',
      color: '#fff',
      position: 'relative'
    }}>
      <div className="pulse-animation" style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        animation: 'pulse 2s infinite'
      }}>
        <ShieldAlert className="text-neon-cyan" size={80} style={{ filter: 'drop-shadow(0 0 20px rgba(0, 240, 255, 0.6))' }} />
        <h1 style={{ marginTop: '20px', letterSpacing: '2px', fontSize: '28px' }}>
          MFX <span className="text-neon-cyan">Security</span>
        </h1>
        <p className="text-secondary" style={{ marginTop: '10px', fontSize: '14px', letterSpacing: '4px' }}>
          TACTICAL COMMS
        </p>
      </div>

      <div style={{ 
        position: 'absolute', 
        bottom: '40px', 
        textAlign: 'center',
        opacity: 0.7
      }}>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>Ecosistema</p>
        <p style={{ margin: '4px 0', fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>Master FixPc</p>
        <p style={{ margin: 0, fontSize: '10px', color: 'var(--neon-cyan)', letterSpacing: '1px' }}>PROGRAMADO POR HECTOR LOZANO</p>
      </div>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
