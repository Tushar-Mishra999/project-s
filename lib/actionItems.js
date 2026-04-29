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

function stripFences(text) {
  let t = (text || '').trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return t;
}

function extractFirstArray(text) {
  // Find the first [...] block — defensive fallback if the model prepends prose
  const m = text.match(/\[[\s\S]*\]/);
  return m ? m[0] : null;
}

export async function extractActionItems(documentText, model) {
  if (!documentText || documentText.trim().length < 50) {
    console.log('[action-items] document too short to extract from');
    return [];
  }

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
    console.error('[action-items] LLM call failed:', err.message);
    throw err;  // bubble up so caller can surface the error
  }

  if (!raw || !raw.trim()) {
    console.error('[action-items] LLM returned empty response');
    throw new Error('LLM returned empty response');
  }

  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err1) {
    // Try defensive extraction
    const arr = extractFirstArray(raw);
    if (arr) {
      try {
        parsed = JSON.parse(arr);
      } catch (err2) {
        console.error('[action-items] JSON parse failed (both attempts). Raw response:\n', raw);
        throw new Error('Failed to parse LLM response as JSON');
      }
    } else {
      console.error('[action-items] No JSON array found in response. Raw response:\n', raw);
      throw new Error('No JSON array in LLM response');
    }
  }

  if (!Array.isArray(parsed)) {
    console.error('[action-items] LLM response was not an array. Got:', typeof parsed, raw.slice(0, 200));
    throw new Error('LLM response was not a JSON array');
  }

  const items = parsed
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((text) => ({ id: randomUUID(), text: text.trim(), completed: false }));

  console.log(`[action-items] LLM returned ${parsed.length} raw, ${items.length} valid items`);
  return items;
}
