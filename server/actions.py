"""The suggestions the assistant writes into a reply, which the owner confirms one at a time.

The model cannot save anything. It writes a fenced block with the language `action`, holding one
JSON object, and the website shows it as a card with a confirm button.
"""

import re
import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter, ValidationError

ACTION_BLOCK = re.compile(r"```action[ \t]*\r?\n(.*?)```", re.S)


class CreateTask(BaseModel):
    type: Literal["create_task"]
    title: str = Field(min_length=1, max_length=300)
    due: date | None = None


class CreateNote(BaseModel):
    type: Literal["create_note"]
    title: str = Field(min_length=1, max_length=200)
    content: str = Field("", max_length=50_000)


class CompleteTask(BaseModel):
    type: Literal["complete_task"]
    task_id: uuid.UUID


Action = Annotated[CreateTask | CreateNote | CompleteTask, Field(discriminator="type")]
ACTION = TypeAdapter(Action)


def parse_actions(reply: str) -> list[Action | None]:
    """Every action block in a reply, in order. A block that does not validate stays in the list
    as None, so a block's index is the same whichever of them are valid."""
    actions: list[Action | None] = []
    for block in ACTION_BLOCK.findall(reply):
        try:
            actions.append(ACTION.validate_json(block.strip()))
        except ValidationError:
            actions.append(None)
    return actions
