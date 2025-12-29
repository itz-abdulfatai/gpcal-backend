// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs

// https://pgftxzgnqsmqoqzmkwrc.supabase.co/functions/v1/gpcal-ai

import OpenAI from "OpenAI";
import { z } from "zod";

import "functions-js/edge-runtime.d.ts";

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 5;

const ipMap = new Map<string, { count: number; firstRequest: number }>();
const SYSTEM_PROMPT = `You are gpcal, an academic performance analyst.

Context:
The frontend already displays the semester GPA, cumulative GPA, grading scale, course grades, credit units, and performance charts.
The user is requesting analytical insight into overall semester performance.


Rules:
Always respond in valid JSON.
Follow this schema exactly:
{
  "reply": string,
  "suggested_improvement"?: string
}

Do not include markdown, code fences, or any text outside the JSON object.

Do not repeat or restate values already visible in the UI, including GPA numbers, CGPA numbers, grading scales, or grades.

Do not calculate or estimate GPA values since it is already in the payload sent to you.

B grades upwards represent solid performance and academic stability.
Only identify imbalance when non top tier performance is concentrated in the highest credit weight courses, creating outsized impact on overall results.
Avoid framing strong performance as needing correction.

Behavior:
Focus on interpretation, not presentation.

In "reply":
Analyze patterns in the semester data.
Explain what is shaping the overall performance.
Identify imbalance, consistency issues, risk concentration, or leverage points.
Highlight what matters most academically and why.

In "suggested_improvement":
Include only if there is a meaningful opportunity for improvement.
Describe the highest impact area for improvement in plain language.
Keep it realistic, concise, and grounded strictly in the provided data.
Omit this field entirely if performance is already strong or well balanced.

Tone:
Clear, analytical, and practical.
No praise, fluff, or generic academic advice.
`;

export const AIResponseSchema = z.object({
  reply: z.string().min(1),
  suggested_improvement: z.string().min(1).optional(),
});

const MessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1),
  })
  .strict();

const BodySchema = z
  .object({
    input: z.string().min(1),
    semester: z.record(z.string(), z.unknown()), // flexible schema for semester data
  })
  .strict();

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_APIKEY"),
});

console.log("Hello from GPcal-ai api!");

Deno.serve(async (req) => {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    console.log('user ip', ip);
    
    

      const now = Date.now();
    const record = ipMap.get(ip);

    if (record) {
      if (now - record.firstRequest < RATE_LIMIT_WINDOW) {
        if (record.count >= MAX_REQUESTS) {
          return new Response(JSON.stringify({
            msg: "Too many requests"
          }), { status: 429 });
        } else {
          record.count++;
          ipMap.set(ip, record);
        }
      } else {
        // window expired
        ipMap.set(ip, { count: 1, firstRequest: now });
      }
    } else {
      ipMap.set(ip, { count: 1, firstRequest: now });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({
            msg: "Method Not Allowed"
          }), { status: 405 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    let body: z.infer<typeof BodySchema>;
    try {
      const reqJson = await req.json();
      body = BodySchema.parse(reqJson);
    } catch (error) {
      console.error("Invalid request body:", error);
      return new Response(JSON.stringify({
            msg: "Invalid request body"
          }), { status: 400 });
    }

    const messages: z.infer<typeof MessageSchema>[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify({
          intent: body.input,
          semester: body.semester,
          note:
            "semester is an object containing term name, semester GPA, cumulative GPA, grading system, and a list of courses with credit units and grade points.",
        }),
      },
    ];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,

    }, {
      signal: controller.signal, // for timeout
    });
    clearTimeout(timeout);

    const text = response.output_text;
    if (!text) throw new Error("No AI response");
    console.log("Ai response text:", text);

    let aiData;
    try {
      aiData = AIResponseSchema.parse(JSON.parse(text));
    } catch  {
      // fallback: try to fix missing commas with regex (simple hack)
      const fixedText = text.replace(
        /"\s+"suggested_improvement"/,
        '", "suggested_improvement"',
      );
      try {
        
        aiData = AIResponseSchema.parse(JSON.parse(fixedText));
      } catch (error) {
         console.error("Failed to parse AI JSON, returning fallback:", error);
  aiData = { reply: "Sorry, could not generate insights. Try again." };
      }
    }
    return new Response(JSON.stringify(aiData), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.log("Ai request error:", error);

    return new Response(JSON.stringify({
            msg:"Ai request failed"
          }), { status: 500 });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/gpcal-ai' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
