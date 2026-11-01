/** Text of a PDF the user attached. Runs in the browser so the file itself is never uploaded. */
export async function textFromPdfBytes(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes.slice());
  const extracted = await extractText(pdf, { mergePages: true });
  const text = extracted.text;
  const joined = Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
  return joined.replace(/\s+/g, " ").trim();
}
