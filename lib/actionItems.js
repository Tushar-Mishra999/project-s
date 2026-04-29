import { randomUUID } from 'node:crypto';
import { generateText } from './llm.js';

const EXTRACTION_PROMPT = `You are an assistant that extracts action items from documents.

An action item is a specific task, to-do, or commitment that needs follow-up. Look for:
- Tasks explicitly assigned to someone ("X to review…", "Team must…", "Owner: Y")
- Action verbs pointing to work still to be done: Review, Update, Send, Schedule, Follow up, Prepare, Finalize, Confirm, Resolve, Share, Coordinate
- Decisions that require implementation steps
- Open items, pending approvals, or unresolved issues flagged in the document

Return ONLY a valid JSON array of concise, self-contained action item strings.
Each item should be clear enough to act on without reading the full document.
If no action items are found, return an empty array: []

Example output:
["Review Q3 budget proposal and share feedback with the finance team by Friday",
 "Schedule kickoff meeting with all stakeholders before end of month",
 "Update project timeline in the tracker to reflect the new delivery date"]`;

export async function extractActionItems(documentText, model) {
  if (!documentText || documentText.trim().length < 50) return [];

  const truncated = documentText.slice(0, 16000);

  let raw;
  try {
    raw = await generateText({
      model,
      system: EXTRACTION_PROMPT,
      user: `Extract all action items from the following document:\n\n${truncated}`,
      jsonMode: true,
      maxTokens: 1024,
    });
  } catch (err) {
    console.warn('[action-items] LLM call failed:', err.message);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((text) => ({ id: randomUUID(), text: text.trim(), completed: false }));
}
