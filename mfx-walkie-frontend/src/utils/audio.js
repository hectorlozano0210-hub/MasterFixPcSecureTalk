export const startSOSAlarm = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return { stop: () => {} };
  
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  
  // LFO para efecto de sirena continua
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 3; // Velocidad del pitido alternante
  
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 400; // Rango de frecuencia
  
  osc.frequency.value = 1000; // Frecuencia base
  
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  
  gain.gain.value = 0.5;

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  lfo.start();
  
  return {
    stop: () => {
      try {
        osc.stop();
        lfo.stop();
        ctx.close();
      } catch (e) {
        console.error("Error stopping SOS alarm", e);
      }
    }
  };
};

export const playRogerBeep = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  
  const ctx = new AudioContext();
  
  // Zello-style double chirp
  const playTone = (freq, startTime, duration) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
    gain.gain.setValueAtTime(0.3, startTime + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(startTime);
    osc.stop(startTime + duration);
  };

  const now = ctx.currentTime;
  playTone(1200, now, 0.08);         // Primer pitido
  playTone(1500, now + 0.1, 0.08);   // Segundo pitido

  // Cerrar el contexto de audio tras finalizar la reproducción (aproximadamente 300ms)
  setTimeout(() => {
    try {
      ctx.close();
    } catch (e) {
      console.error("Error al cerrar AudioContext en playRogerBeep:", e);
    }
  }, 500);
};

export const playTextPing = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.start();
  osc.stop(ctx.currentTime + 0.2);

  // Cerrar el contexto de audio tras finalizar la reproducción
  setTimeout(() => {
    try {
      ctx.close();
    } catch (e) {
      console.error("Error al cerrar AudioContext en playTextPing:", e);
    }
  }, 500);
};

