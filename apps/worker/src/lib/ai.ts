import { toJSONSchema, type z } from "zod";

interface GenerateObjectOptions<T extends z.ZodType> {
  ai: Ai;
  model: string;
  schema: T;
  schemaName: string;
  system: string;
  prompt: string;
}

export async function generateObject<T extends z.ZodType>(
  opts: GenerateObjectOptions<T>,
): Promise<{ object: z.infer<T> }> {
  const jsonSchema = toJSONSchema(opts.schema);

  const result = await opts.ai.run(opts.model as Parameters<Ai["run"]>[0], {
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: opts.schemaName,
        schema: jsonSchema,
      },
    },
  });

  const resultObj = result as Record<string, unknown>;
  const response = resultObj.response;
  const parsed = typeof response === "string" ? JSON.parse(response) : response;
  const unwrapped =
    parsed && typeof parsed === "object" && opts.schemaName in (parsed as Record<string, unknown>)
      ? (parsed as Record<string, unknown>)[opts.schemaName]
      : parsed;
  return { object: opts.schema.parse(unwrapped) as z.infer<T> };
}
