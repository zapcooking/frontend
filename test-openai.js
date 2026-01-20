import "dotenv/config";
import OpenAI from "openai";

console.log("API key loaded:", !!process.env.OPENAI_API_KEY);

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const response = await client.responses.create({
  model: "gpt-4.1-mini",
  input: "Say hello from the Sous Chef.",
});

console.log(response.output_text);

