import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const judgeModel = ai.models;
export const JUDGE_MODEL_ID = "gemini-2.5-pro";
