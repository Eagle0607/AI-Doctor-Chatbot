import { useEffect, useMemo, useState } from "react";
import { sendMessage as sendMessageAPI } from "../api";

let recognition = null;
let silenceTimer = null;

export default function Chatbot() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [tone, setTone] = useState("simple");
  const [stage, setStage] = useState("ask_mode");
  const [loading, setLoading] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");

  const user_id = useMemo(() => {
    let id = localStorage.getItem("chat_user");
    if (!id) {
      id = "user-" + Math.random().toString(36).substring(2, 9);
      localStorage.setItem("chat_user", id);
    }
    return id;
  }, []);

  const speak = (text) => {
    if (!ttsOn) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\*/g, ""));
    u.lang = "en-IN";
    u.onstart = () => stopListening();
    u.onend = () => voiceMode && startListening();
    window.speechSynthesis.speak(u);
  };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    recognition = new SR();
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join("").trim();
      setVoiceTranscript(text);
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        setVoiceTranscript("");
        sendMessage(text, true);
      }, 2500);
    };

    recognition.start();
  };

  const stopListening = () => { try { recognition && recognition.stop(); } catch { } };

  useEffect(() => {
    (async () => {
      const res = await sendMessageAPI({ user_id, message: "", tone });
      setStage(res.stage);
      setMessages([{ sender: "bot", text: res.reply }]);
    })();
  }, []);

  const sendLocation = () => {
    navigator.geolocation.getCurrentPosition((pos) => {
      sendMessageAPI({ user_id, tone, lat: pos.coords.latitude, lon: pos.coords.longitude })
        .then((res) => {
          setStage(res.stage);
          setMessages((p) => [...p, { sender: "bot", text: res.reply }]);
          speak(res.reply);
        });
    });
  };

  const sendMessage = async (override, fromVoice = false) => {
    const raw = override ?? input;
    if (!raw.trim()) return;
    let msg = raw.trim();

    if (stage === "ask_mode") {
      if (msg === "1") msg = "text";
      if (msg === "2") msg = "voice";
      if (msg === "3") msg = "both";
    }

    if (!fromVoice) setMessages((p) => [...p, { sender: "user", text: msg }]);
    else {
      stopListening();
      setMessages((p) => [...p, { sender: "user", text: `🎤 ${msg}` }]);
    }

    setInput("");
    setLoading(true);

    let payload = { user_id, tone };
    if (stage === "ask_mode") {
      payload.mode = msg;
      if (msg === "voice" || msg === "both") {
        setVoiceMode(true);
        setTtsOn(true);
        setTimeout(() => speak("Okay, I am listening. Tell me how you feel."), 500);
        setTimeout(startListening, 2000);
      }
    } else if (stage === "ask_location") payload.location = msg;
    else if (stage === "ask_symptoms") payload.symptoms = msg;
    else payload.message = msg;

    try {
      const res = await sendMessageAPI(payload);
      setStage(res.stage);
      setMessages((p) => [...p, { sender: "bot", text: res.reply }]);
      speak(res.reply);
      if (voiceMode) setTimeout(startListening, 600);
    } catch {
      setMessages((p) => [...p, { sender: "bot", text: "Server error." }]);
    }

    setLoading(false);
  };

  const QuickReplies = () => {
    if (voiceMode) return null;
    if (stage === "ask_mode")
      return (
        <div style={row}>
          <button style={chip} onClick={() => sendMessage("1")}>1) Text</button>
          <button style={chip} onClick={() => sendMessage("2")}>2) Voice</button>
          <button style={chip} onClick={() => sendMessage("3")}>3) Both</button>
        </div>
      );

    if (stage === "ask_location")
      return (
        <div style={row}>
          <button style={chip} onClick={sendLocation}>📍 Auto Detect</button>
          {["Noida", "Greater Noida", "Delhi"].map((c) => (
            <button key={c} style={chip} onClick={() => sendMessage(c)}>{c}</button>
          ))}
        </div>
      );

    if (stage === "ask_symptoms")
      return (
        <div style={row}>
          {["mild cold", "fever 2 days", "dry cough"].map((s) => (
            <button key={s} style={chip} onClick={() => sendMessage(s)}>{s}</button>
          ))}
        </div>
      );

    return null;
  };

  return (
    <div style={container}>
      {!voiceMode && (
        <div style={header}>
          <img src="https://cdn-icons-png.flaticon.com/512/4712/4712100.png" alt="AI" style={botImage} />
          <div>
            <h1 style={{ margin: 0, fontSize: "22px" }}>Hello, welcome to your AI Doctor 👋</h1>
            <p style={{ margin: 0, opacity: 0.7 }}>Tell me how you feel today.</p>
          </div>
        </div>
      )}

      {voiceMode ? (
        <div style={voiceScreen}>
          <h2>🎤 Listening...</h2>
          <p style={{ marginTop: 20, fontSize: 18, opacity: 0.85 }}>{voiceTranscript || "Speak…"}</p>
          <button onClick={() => { setVoiceMode(false); stopListening(); }} style={stopBtn}>⏹ Stop</button>
        </div>
      ) : (
        <>
          <div style={chatWindow}>
            {messages.map((m, i) => (
              <div key={i} style={{ textAlign: m.sender === "user" ? "right" : "left" }}>
                <div style={m.sender === "user" ? userMsg : botMsg}>{m.text}</div>
              </div>
            ))}
            {loading && <p style={{ opacity: 0.6 }}>Typing…</p>}
            <QuickReplies />
          </div>

          <div style={inputRow}>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Type your message…" style={textInput} />
            <button onClick={() => sendMessage()} style={sendBtn}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---- DARK PREMIUM UI ---- */
const container = {
  width: "65%",
  height: "90vh",
  margin: "30px auto",
  background: "linear-gradient(135deg, #0b0d10 0%, #14171b 100%)",
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 10px 40px rgba(0,0,0,0.65)",
  color: "#e6e6e6",
  display: "flex",
  flexDirection: "column",
  border: "1px solid rgba(255,255,255,0.08)"
};

const header = { display: "flex", alignItems: "center", gap: 16, marginBottom: 22, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.08)" };
const botImage = {
  width: 60,
  height: 60,
  borderRadius: "50%",
  padding: 5,
  background: "radial-gradient(circle, #1a1d21, #0f1215)",
  border: "2px solid #3a8bff",
  animation: "glowPulse 2.4s ease-in-out infinite",
  boxShadow: "0 0 14px rgba(58,139,255,0.45)"
};

const chatWindow = { flex: 1, overflowY: "auto", background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "18px 20px", marginBottom: 14, border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(6px)" };

const userMsg = { background: "linear-gradient(135deg, #3a7bd5, #295fa0)", padding: "10px 14px", borderRadius: 14, margin: "6px 0", maxWidth: "75%", display: "inline-block", color: "white", boxShadow: "0 4px 10px rgba(0,0,0,0.4)" };
const botMsg = { background: "rgba(255,255,255,0.08)", padding: "10px 14px", borderRadius: 14, margin: "6px 0", maxWidth: "75%", display: "inline-block", color: "#e6e6e6", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 10px rgba(0,0,0,0.35)" };

const inputRow = { display: "flex", gap: 10, paddingTop: 8 };
const textInput = { flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", padding: 14, borderRadius: 12, color: "white", outline: "none", backdropFilter: "blur(4px)" };
const sendBtn = { background: "linear-gradient(135deg, #3a7bd5, #295fa0)", border: "none", padding: "14px 20px", borderRadius: 12, cursor: "pointer", fontWeight: "bold", color: "white", boxShadow: "0 4px 12px rgba(0,0,0,0.45)" };

const chip = { padding: "8px 14px", borderRadius: "999px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer", color: "white", backdropFilter: "blur(4px)" };
const row = { display: "flex", gap: 10, marginTop: 10 };

const voiceScreen = { textAlign: "center", padding: 30, background: "rgba(255,255,255,0.05)", backdropFilter: "blur(6px)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)" };
const stopBtn = { marginTop: 25, padding: "10px 20px", borderRadius: 8, background: "#ff3b3b", color: "white", border: "none", cursor: "pointer" };
