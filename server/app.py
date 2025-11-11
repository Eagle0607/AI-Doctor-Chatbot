import os
import time
import requests
from typing import Optional, Dict, Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import google.generativeai as genai

# ---------------- ENV + MODEL SETUP ----------------
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OWM_API_KEY = os.getenv("OWM_API_KEY") or "54af1851c1cb1cc209aaef378903c92b"

if not GEMINI_API_KEY:
    raise RuntimeError("❌ GEMINI_API_KEY missing in .env")

genai.configure(api_key=GEMINI_API_KEY)

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    system_instruction=(
        "You are an AI Medical Assistant.\n"
        "Respond in **3–5 short bullet points only**.\n"
        "Do not write long paragraphs.\n"
        "Only mention weather if useful.\n"
        "Always end with: Disclaimer: This is not a substitute for professional medical advice."
    )
)

# ---------------- FASTAPI ----------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- SESSION MEMORY ----------------
SESSIONS: Dict[str, Dict[str, Any]] = {}
SESSION_TTL = 1800  # 30 minutes


def get_session(user_id: str):
    now = time.time()
    ses = SESSIONS.get(user_id, {"created": now, "stage": "ask_mode"})
    if now - ses["created"] > SESSION_TTL:
        ses = {"created": now, "stage": "ask_mode"}
    SESSIONS[user_id] = ses
    return ses

# ---------------- MODELS ----------------
class ChatRequest(BaseModel):
    user_id: str
    message: Optional[str] = ""
    tone: Optional[str] = "simple"
    mode: Optional[str] = None
    location: Optional[str] = None
    symptoms: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None


class ChatResponse(BaseModel):
    reply: str
    stage: str
    needs: Dict[str, bool]
    escalate: bool = False
    hospitals: Optional[list] = None
    case_summary: Optional[str] = None


# ---------------- HELPERS ----------------
def fetch_weather(city):
    try:
        r = requests.get(
            f"https://api.openweathermap.org/data/2.5/weather?q={city}&appid={OWM_API_KEY}&units=metric"
        )
        return r.json() if r.status_code == 200 else None
    except:
        return None


def fetch_weather_by_coords(lat, lon):
    try:
        r = requests.get(
            f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric"
        )
        return r.json() if r.status_code == 200 else None
    except:
        return None


CITY_HOSPITALS = {
    "noida": ["Jaypee Hospital", "Fortis Hospital"],
    "greater noida": ["Yatharth Hospital", "Sharda Hospital"],
    "delhi": ["AIIMS", "Sir Ganga Ram Hospital"],
}


def severe(symptoms):
    return any(s in symptoms.lower() for s in ["chest pain", "blood", "fainting", "difficulty breathing"])


# ---------------- MAIN CHAT LOGIC ----------------
@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    ses = get_session(req.user_id)

    # MODE SELECTION
    if ses["stage"] == "ask_mode" and req.mode:
        ses["mode"] = req.mode
        ses["stage"] = "ask_location"

    # LOCATION STAGE (auto or manual)
    if ses["stage"] == "ask_location":
        # Auto location
        if req.lat and req.lon:
            wx = fetch_weather_by_coords(req.lat, req.lon)
            if wx and "name" in wx:
                ses["location"] = wx["name"]
                ses["stage"] = "ask_symptoms"
                return ChatResponse(
                    reply=f"Detected your location as **{wx['name']}**.\nHow are you feeling? Describe symptoms briefly.",
                    stage="ask_symptoms",
                    needs={"mode": False, "location": False, "symptoms": True},
                )

        # Manual city name
        if req.location:
            ses["location"] = req.location
            ses["stage"] = "ask_symptoms"
            return ChatResponse(
                reply="How are you feeling? Describe symptoms briefly.",
                stage="ask_symptoms",
                needs={"mode": False, "location": False, "symptoms": True},
            )

        return ChatResponse(
            reply="Send your location or type your city (e.g., Noida / Delhi):",
            stage="ask_location",
            needs={"mode": False, "location": True, "symptoms": False},
        )

    # SYMPTOM STAGE
    if ses["stage"] == "ask_symptoms" and req.symptoms:
        ses["symptoms"] = req.symptoms
        ses["stage"] = "answer"

    # PROMPT ASKING STAGES
    if ses["stage"] == "ask_mode":
        return ChatResponse(
            reply="How would you like advice?\n1) Text\n2) Voice\n3) Both",
            stage="ask_mode",
            needs={"mode": True, "location": False, "symptoms": False}
        )

    if ses["stage"] == "ask_symptoms":
        return ChatResponse(
            reply="Describe symptoms briefly:",
            stage="ask_symptoms",
            needs={"mode": False, "location": False, "symptoms": True}
        )

    # FINAL RESPONSE
    city = ses["location"]
    symptoms = ses["symptoms"]
    wx = fetch_weather(city)

    prompt = f"Tone={req.tone}. City={city}. Symptoms={symptoms}. Weather={wx}."

    try:
        result = model.generate_content([prompt])
        reply = result.text.strip()
    except:
        reply = "I couldn't think clearly. Try again.\nDisclaimer: This is not a substitute for professional medical advice."

    esc = severe(symptoms)
    hospitals = CITY_HOSPITALS.get(city.lower(), [])

    ses["stage"] = "ask_mode"

    return ChatResponse(
        reply=reply,
        stage="answer",
        needs={"mode": False, "location": False, "symptoms": False},
        escalate=esc,
        hospitals=hospitals,
        case_summary=f"{symptoms} in {city}" if esc else None
    )


@app.get("/")
def root():
    return {"status": "OK", "message": "POST /chat to chat"}
