import { execSync } from 'child_process';

// Read the prompt from command-line args, or fallback to a default
const USER_PROMPT = process.argv.slice(2).join(" ") || "Show me the changeovers scheduled for June 27, 2026";
const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL_NAME = "gemma4:latest";
const SHOULD_SUGGEST_TROUBLESHOOTING = /\b(troubleshoot|troubleshooting|diagnos|root cause|next steps?|what should|suggest|recommend|fix|resolve|repair)\b/i.test(USER_PROMPT);

function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return formatLocalDate(date);
}

function previousWeekdayDate(targetDay) {
    const date = new Date();
    const diff = (date.getDay() - targetDay + 7) % 7 || 7;
    date.setDate(date.getDate() - diff);
    return formatLocalDate(date);
}

const DATE_CONTEXT = {
    today: dateDaysAgo(0),
    yesterday: dateDaysAgo(1),
    lastFriday: previousWeekdayDate(5)
};

const DATABASE_SCHEMA = `
Tables and columns:
1. Table "daily_schedules"
   - Columns: daily_schedule_row_id (TEXT, PK), plant_id (TEXT), schedule_date (TEXT, YYYY-MM-DD), shift (TEXT), line_speed (TEXT), total_planned_pcs (TEXT), source_file_name (TEXT), source_file_type (TEXT), status (TEXT), notes (TEXT), created_at (TEXT), updated_at (TEXT)
2. Table "daily_schedule_rows"
   - Columns: daily_schedule_item_row_id (TEXT, PK), plant_id (TEXT), schedule_date (TEXT, YYYY-MM-DD), section_key (TEXT), row_id (TEXT), press (TEXT), part_number (TEXT), description (TEXT), cavity (TEXT), doh (TEXT), labels_per_shift (TEXT), mc (TEXT), notes (TEXT), shift (TEXT), created_at (TEXT), updated_at (TEXT)
3. Table "issues"
   - Columns: issue_id (TEXT, PK), plant_id (TEXT), press_id (TEXT), machine_code (TEXT), row_id (TEXT), title (TEXT), note (TEXT), description (TEXT), issue_type (TEXT), priority (TEXT), severity (TEXT), high_priority (INTEGER, 0 or 1), current_status_key (TEXT), current_sub_status_key (TEXT), current_status_label (TEXT), current_sub_status_label (TEXT), current_status_entered_at (TEXT), current_status_entered_by_name (TEXT), is_open (INTEGER, 0 or 1), is_resolved (INTEGER, 0 or 1), opened_at (TEXT), resolved_at (TEXT), closed_at (TEXT), assigned_team (TEXT), assigned_user_name (TEXT), serial_required (INTEGER, 0 or 1), serial_captured (INTEGER, 0 or 1), serial_value (TEXT), reporting_date_key (TEXT, YYYY-MM-DD), reporting_week_key (TEXT), reporting_month_key (TEXT), reporting_shift_key (TEXT), workflow_state (TEXT), latest_note_preview (TEXT), tags_json (TEXT JSON), photo_count (INTEGER), created_by_name (TEXT), updated_by_name (TEXT), created_at (TEXT), updated_at (TEXT), schema_version (INTEGER)
4. Table "issue_events"
   - Columns: event_id (TEXT, PK), issue_id (TEXT, FK to issues.issue_id), plant_id (TEXT), event_type (TEXT, examples: issue_created, status_changed), event_at (TEXT), actor_uid (TEXT), actor_name (TEXT), payload_json (TEXT JSON), dedupe_key (TEXT), created_at (TEXT)
   - Issue log entry notes are stored inside payload_json. Use json_extract(payload_json, '$.note') as log_note.
   - Status transitions are stored inside payload_json. Use json_extract(payload_json, '$.fromStatusKey'), json_extract(payload_json, '$.fromSubStatusKey'), json_extract(payload_json, '$.toStatusKey'), and json_extract(payload_json, '$.toSubStatusKey').
   - Join issue log entries with issues using: issue_events.issue_id = issues.issue_id AND issue_events.plant_id = issues.plant_id.
5. Table "notes"
   - Columns: note_id (TEXT, PK), plant_id (TEXT), title (TEXT), body_text (TEXT), tags_json (TEXT JSON), press_id (TEXT), machine_code (TEXT), issue_id (TEXT), is_pinned (INTEGER, 0 or 1), is_archived (INTEGER, 0 or 1), photo_count (INTEGER), search_text (TEXT), created_by_uid (TEXT), updated_by_uid (TEXT), created_at (TEXT), updated_at (TEXT)
   - These are shift-log/wiki notes. They may link to an issue using notes.issue_id, but issue timeline notes usually come from issue_events.payload_json.
6. Table "press_notes"
   - Columns: press_note_id (TEXT, PK), plant_id (TEXT), press_id (TEXT), machine_code (TEXT), text (TEXT), photo_count (INTEGER), photos_json (TEXT JSON), created_by_json (TEXT JSON), created_at (TEXT), schema_version (INTEGER)

Notes on data query logic:
- A "changeover" or "change" is represented in the "daily_schedule_rows" table by a row where the "section_key" column is 'northBayChanges' or 'southBayChanges'.
- When the user asks to search for issues in a certain category, generate a SQLite query using LIKE filters with wildcards (%) against the "title", "note", or "description" columns of the "issues" table. Include common synonyms:
  * Downtime / Stoppage: down, stop, broken, fault, downtime, fail, leak, jam, stuck, inactive
  * Quality / Defects: scrap, defect, reject, bad, quality, scratch, flash, short shot, warp, color
  * Maintenance / Repairs: fix, repair, maintenance, pm, adjust, mechanic, service, replace
  * Tooling / Mold: mold, tool, tooling, setup, swap, changeover, set mold, pull mold
  * Material: material, resin, shortage, stage, staged, out of, stock
- When the user asks about issue log entries, history, comments, notes, status updates, or troubleshooting evidence, query "issue_events" and include:
  json_extract(issue_events.payload_json, '$.note') AS log_note
- For troubleshooting requests, return enough issue context for a second Gemma pass:
  issue_id, machine_code, press_id, title, note, description, issue_type, priority, severity, current_status_label, latest_note_preview, event_at, actor_name, event_type, log_note, to_status_key, to_sub_status_key.
- For troubleshooting requests, prefer ordering by issue_events.event_at ASC so the model can see the sequence of actions already tried.
`;

const TROUBLESHOOTING_RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        issue_summary: { type: "string" },
        evidence_notes: {
            type: "array",
            items: { type: "string" }
        },
        likely_causes: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    cause: { type: "string" },
                    why_it_fits: { type: "string" },
                    confidence: { type: "string", enum: ["low", "medium", "high"] }
                },
                required: ["cause", "why_it_fits", "confidence"]
            }
        },
        troubleshooting_steps: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    step: { type: "string" },
                    reason: { type: "string" },
                    expected_signal: { type: "string" }
                },
                required: ["step", "reason", "expected_signal"]
            }
        },
        safety_notes: {
            type: "array",
            items: { type: "string" }
        },
        follow_up_questions: {
            type: "array",
            items: { type: "string" }
        }
    },
    required: ["issue_summary", "evidence_notes", "likely_causes", "troubleshooting_steps", "safety_notes", "follow_up_questions"]
};

const systemPrompt = `You are a SQLite expert. Given the database schema:
${DATABASE_SCHEMA}
Current date context:
- Today is ${DATE_CONTEXT.today}.
- Yesterday was ${DATE_CONTEXT.yesterday}.
- Last Friday was ${DATE_CONTEXT.lastFriday}.

Generate ONLY a raw SQLite query to answer the user's request.
CRITICAL rules:
1. Do NOT wrap the query in markdown code blocks like \`\`\`sql. Just return the raw SQL string.
2. Ensure you query real table names from the schema, NOT column names.
3. For issue log notes, use the "issue_events" table and write the full expression json_extract(issue_events.payload_json, '$.note') AS log_note, adjusted to the table alias if you use one.
4. For troubleshooting requests, join "issues" to "issue_events" and select issue context plus full JSON extraction expressions for log_note, to_status_key, and to_sub_status_key.
5. Never output placeholders like YYYY-MM-DD, -N day, or date math variables. Use concrete YYYY-MM-DD values from the current date context.
6. Keep the query on a single line.`;

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function stripSqlMarkdown(value) {
    return String(value || '')
        .trim()
        .replace(/^```(?:sql)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function issueEventsPayloadRef(sql) {
    const match = sql.match(/\b(?:FROM|JOIN)\s+issue_events(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/i);
    const alias = match?.[1];
    if (!alias || /^(ON|WHERE|JOIN|LEFT|INNER|OUTER|GROUP|ORDER|LIMIT)$/i.test(alias)) return 'issue_events.payload_json';
    return `${alias}.payload_json`;
}

function replaceBareAlias(sql, alias, expression) {
    const pattern = new RegExp(`(?<!\\.)\\b${alias}\\b`, 'gi');
    return sql.replace(pattern, (match, offset, fullSql) => {
        const before = fullSql.slice(Math.max(0, offset - 4), offset).toUpperCase();
        if (/\bAS\s$/.test(before)) return match;
        return expression;
    });
}

function normalizeGeneratedSQL(rawSql) {
    let sql = stripSqlMarkdown(rawSql);
    const payloadRef = issueEventsPayloadRef(sql);
    const jsonExpressions = {
        log_note: `json_extract(${payloadRef}, '$.note')`,
        to_status_key: `json_extract(${payloadRef}, '$.toStatusKey')`,
        to_sub_status_key: `json_extract(${payloadRef}, '$.toSubStatusKey')`,
        from_status_key: `json_extract(${payloadRef}, '$.fromStatusKey')`,
        from_sub_status_key: `json_extract(${payloadRef}, '$.fromSubStatusKey')`
    };

    for (const [alias, expression] of Object.entries(jsonExpressions)) {
        sql = replaceBareAlias(sql, alias, expression);
    }

    if (/\blast friday\b/i.test(USER_PROMPT)) {
        const fridayPredicate = `T1.reporting_date_key = '${DATE_CONTEXT.lastFriday}'`;
        sql = sql
            .replace(/T1\.reporting_date_key\s+LIKE\s+'YYYY-MM-DD'\s+AND\s+T1\.reporting_date_key\s+<=\s+date\('now',\s*'-N day'\)/i, fridayPredicate)
            .replace(/\bT1\.reporting_date_key\s+(?:LIKE|=)\s+'YYYY-MM-DD'/gi, fridayPredicate)
            .replace(/\breporting_date_key\s+(?:LIKE|=)\s+'YYYY-MM-DD'/gi, `reporting_date_key = '${DATE_CONTEXT.lastFriday}'`)
            .replace(/date\('now',\s*'-N day'\)/gi, `'${DATE_CONTEXT.lastFriday}'`);
    }

    if (SHOULD_SUGGEST_TROUBLESHOOTING) {
        sql = sql.replace(/\s+GROUP\s+BY\s+T1\.issue_id(?=\s+ORDER\s+BY|\s+LIMIT|;|$)/i, '');
    }

    if (/\bYYYY-MM-DD\b|-N day/i.test(sql)) {
        throw new Error(`Gemma returned SQL with an unresolved date placeholder. Try again, or ask with an explicit date such as ${DATE_CONTEXT.lastFriday}. SQL: ${sql}`);
    }

    return sql;
}

async function getSQLFromLocalLLM() {
    console.log(`🤖 Querying local LLM (${MODEL_NAME})...`);
    const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL_NAME,
            prompt: USER_PROMPT,
            system: systemPrompt,
            stream: false
        })
    });
    const data = await res.json();
    return normalizeGeneratedSQL(data.response);
}

async function getTroubleshootingFromLocalLLM({ sql, queryResult }) {
    console.log(`\n🧰 Asking ${MODEL_NAME} for troubleshooting suggestions from the issue log notes...`);
    const troubleshootingPrompt = `
User request:
${USER_PROMPT}

SQL used:
${sql}

Query result:
${queryResult}

Use the issue fields and issue log notes above to suggest practical manufacturing-floor troubleshooting steps.
Do not claim certainty beyond the evidence. If the data is thin, ask targeted follow-up questions.
Return JSON matching the provided schema.`;

    const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL_NAME,
            prompt: troubleshootingPrompt,
            system: "You are a manufacturing troubleshooting assistant for AP Tracker. Use issue log notes as evidence. Be practical, concise, and safety-aware.",
            stream: false,
            format: TROUBLESHOOTING_RESPONSE_SCHEMA
        })
    });
    const data = await res.json();
    return data.response.trim();
}

async function getAnswerFromLocalLLM({ sql, queryResult }) {
    console.log(`\n📝 Asking ${MODEL_NAME} to answer from the database results...`);
    const answerPrompt = `
User request:
${USER_PROMPT}

SQL used:
${sql}

Query result:
${queryResult}

Answer the user's request using only the database results above.
If there are no result rows, say that no matching records were found.
Keep the answer concise and practical. Include key machine/press IDs, dates, statuses, notes, counts, or schedule details when they are present.
Do not invent details that are not in the query result.`;

    const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL_NAME,
            prompt: answerPrompt,
            system: "You are AP Tracker's local database assistant. Convert D1 query results into a clear answer for the user's question. Use only the provided result data.",
            stream: false
        })
    });
    const data = await res.json();
    return data.response.trim();
}

function printTroubleshooting(jsonText) {
    try {
        const parsed = JSON.parse(jsonText);
        console.log(`\nTroubleshooting Suggestions\n`);
        console.log(`Summary: ${parsed.issue_summary || ''}`);
        if (parsed.evidence_notes?.length) {
            console.log(`\nEvidence from log notes:`);
            parsed.evidence_notes.forEach((note) => console.log(`- ${note}`));
        }
        if (parsed.likely_causes?.length) {
            console.log(`\nLikely causes:`);
            parsed.likely_causes.forEach((item) => console.log(`- [${item.confidence}] ${item.cause}: ${item.why_it_fits}`));
        }
        if (parsed.troubleshooting_steps?.length) {
            console.log(`\nSuggested steps:`);
            parsed.troubleshooting_steps.forEach((item, index) => {
                console.log(`${index + 1}. ${item.step}`);
                console.log(`   Why: ${item.reason}`);
                console.log(`   Look for: ${item.expected_signal}`);
            });
        }
        if (parsed.safety_notes?.length) {
            console.log(`\nSafety notes:`);
            parsed.safety_notes.forEach((note) => console.log(`- ${note}`));
        }
        if (parsed.follow_up_questions?.length) {
            console.log(`\nFollow-up questions:`);
            parsed.follow_up_questions.forEach((question) => console.log(`- ${question}`));
        }
    } catch {
        console.log(jsonText);
    }
}

async function run() {
    try {
        const sql = await getSQLFromLocalLLM();
        console.log(`\nGenerated SQL:\n  ${sql}\n`);

        console.log("⚡ Running query against remote D1...");
        const cmd = `npx wrangler d1 execute coe_db --remote --command ${shellQuote(sql)}`;
        const result = execSync(cmd, { encoding: 'utf-8' });
        console.log(result);

        if (SHOULD_SUGGEST_TROUBLESHOOTING) {
            const troubleshooting = await getTroubleshootingFromLocalLLM({ sql, queryResult: result });
            printTroubleshooting(troubleshooting);
        } else {
            const answer = await getAnswerFromLocalLLM({ sql, queryResult: result });
            console.log(`\nAnswer\n`);
            console.log(answer);
        }
    } catch (err) {
        console.error("Error:", err.message);
    }
}

run();
