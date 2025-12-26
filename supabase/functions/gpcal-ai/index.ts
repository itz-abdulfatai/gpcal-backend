// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs

// https://pgftxzgnqsmqoqzmkwrc.supabase.co/functions/v1/gpcal-ai

// import { createClient } from "supabase-js";
import OpenAI from "OpenAI";
import { z } from "zod";

import "functions-js/edge-runtime.d.ts";

// const supabase = createClient(
//   Deno.env.get("SUPABASE_URL")!,
//   Deno.env.get("SUPABASE_ANON_KEY")!,
//   // Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
// );

// messages: [
//   { role: "system", content: "You are a GPA advisor" },
//   { role: "assistant", content: lastAiMessage },
//   { role: "user", content: selectedButtonText }
// ]


// const response = await openai.responses.create({
//   model: "gpt-4.1-mini",
//   input: messages,
//   response_format: { type: "json_object" }
// });


const SYSTEM_OVERVIEW = `
You are gpcal, a GPA advisor.

Context:
- This is stage 1 (OVERVIEW).
- GPA has already been calculated by the app.
- projected scores in courses of the semester are provided
- cgpa is also provided

Rules:
Always respond in valid JSON 
- Follow this schema exactly:
{
"reply": string
}
- Do not calculate or estimate GPA values.
- Do not suggest actions or next steps.
- Do not include markdown, code fences, or text outside the JSON object.

Behavior:
- Explain what the GPA result indicates.
- Highlight strengths and risks based on semester data.
- Keep the response concise and practical.
- Base all reasoning strictly on provided data.
`;

const SYSTEM_PREDICTION = `
You are gpcal, a GPA advisor.

Context:
- This is stage 2 (PREDICTION).
- A target GPA is provided by the app.
- projected scores in courses of the semester are provided
- cgpa is also provided

Rules:
Always respond in valid JSON 
- Follow this schema exactly:
{
"reply": string
}
- Do not calculate exact GPA outcomes.
- Do not include markdown, code fences, or text outside the JSON object.

Behavior:
- Explain what changes would realistically help reach the target GPA.
- Discuss improvement in key courses.
- Be realistic and avoid guarantees.
- Base advice strictly on the provided context.
`;


const SYSTEM_STUDY_PLAN = `
You are gpcal, a GPA advisor.

Context:
- This is stage 3 (STUDY PLAN).
- The improvement goal has already been chosen.

Rules:
Always respond in valid JSON 
- Follow this schema exactly:
{
"reply": string
}
- Do not include markdown, code fences, or text outside the JSON object.

Behavior:
- Provide clear, actionable study guidance.
- Focus on habits, structure, and execution.
- Avoid generic or motivational fluff.
- Keep the response practical and concise.
`;

export const AIResponseSchema = z.object({
  reply: z.string().min(1),
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
    history: z.array(MessageSchema).max(3).optional(),
    stage: z.number().min(1).max(3).default(1)
  })
  .strict();

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_APIKEY"),
});

console.log("Hello from GPcal-ai api!");

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let body: z.infer<typeof BodySchema>;
    try {
      const reqJson = await req.json();
      body = BodySchema.parse(reqJson);
    } catch (error) {
      console.error("Invalid request body:", error);
      return new Response("Invalid request body", { status: 400 });
    }

    const messages: z.infer<typeof MessageSchema>[] = [
  { role: "system", content: body.stage === 1 ? SYSTEM_OVERVIEW: body.stage === 2 ? SYSTEM_PREDICTION: SYSTEM_STUDY_PLAN  },
  ...(body.history ?? []), // last 2–3 messages
  {
    role: "user",
    content: JSON.stringify({
      intent: body.input,
      semester: body.semester,
      note: 'semester is an object containing term name, semester GPA, cumulative GPA, grading system, and a list of courses with credit units and grade points.'

    })
  }
];

const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  input: messages,
  
}
,{
  signal: controller.signal, // for timeout
}
);
clearTimeout(timeout);
// response_format: { type: "json_object" }

    // const readableStream = new ReadableStream({
    //   async start(controller) {
    //     try {
    //       for await (const chunk of stream) {
    //         const text = chunk.choices[0]?.delta.content;
    //         if (text) controller.enqueue(text);
    //       }

    //       controller.close();
    //     } catch (error) {
    //       console.error("Stream error:", error);
    //       controller.error("Stream error");
    //     }
    //   },
    // });

    const text = response.output_text;
    if (!text) throw new Error("No AI response");
    console.log("Ai response text:", text);

    const aiData = AIResponseSchema.parse(JSON.parse(text));

    const res = {
      data: aiData,

    }

    return new Response(JSON.stringify(res), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.log("Ai request error:", error);

    return new Response("Ai request failed", { status: 500 });
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
