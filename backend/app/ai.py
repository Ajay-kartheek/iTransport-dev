"""Daily operations summaries written by a low-cost Gemini model on Vertex AI.

Facts are computed deterministically (see services/daily.py); the model only
turns them into a few readable lines. It never sees student or parent names.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from .config import get_settings

if TYPE_CHECKING:
    from google import genai


class DaySummary(BaseModel):
    headline: str = Field(description="One short sentence on how the day went.")
    highlights: list[str] = Field(
        description="2 to 5 short sentences: trips, campus arrivals, riding/absent numbers, "
        "office changes."
    )
    attention: list[str] = Field(
        description="Specific things the transport office should look at. Empty if nothing."
    )


SYSTEM_INSTRUCTION = """\
You write the end-of-day summary for a school's bus transport office. You receive one day's
records as JSON. Write for a busy transport manager: plain, specific, no filler.

Rules:
- Use only facts in the JSON. Never guess causes, never invent numbers or events.
- Quote bus numbers, campus names, route names and times exactly as given; times are already
  in local school time.
- headline: one short, concrete sentence (under 15 words) leading with what mattered most.
  Don't repeat the school's name.
- highlights: 2-5 short sentences covering the trips run (and when buses reached each campus),
  how many students were riding, absent or hadn't replied, and any office changes.
- attention: concrete follow-ups only - trips ended by the office or auto-closed, stops passed
  without stopping, long gaps in location updates, buses that didn't run on a school day.
  Return an empty list when there is nothing to follow up.
- If is_today is true the day isn't over: say "so far".
- If it wasn't a school day and nothing happened, say so briefly.
"""

_client: genai.Client | None = None  # the SDK loads on first use, keeping cold starts quick


def ai_enabled() -> bool:
    return bool(get_settings().ai_model)


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        from google import genai

        s = get_settings()
        _client = genai.Client(vertexai=True, project=s.ai_project, location=s.ai_location)
    return _client


async def write_day_summary(facts: dict[str, Any]) -> DaySummary:
    from google.genai import types

    s = get_settings()
    response = await _get_client().aio.models.generate_content(
        model=s.ai_model,
        contents=json.dumps(facts, ensure_ascii=False),
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=DaySummary,
            temperature=0.2,
            max_output_tokens=2048,
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    if isinstance(response.parsed, DaySummary):
        return response.parsed
    return DaySummary.model_validate_json(response.text or "{}")
