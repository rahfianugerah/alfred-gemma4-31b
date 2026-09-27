"""The search ladder from search.component.md, shared by conversations, notes, and tasks."""

from sqlalchemy import Select, func, or_, select, text
from sqlalchemy.orm import Session


def search_stages(session: Session, model, query: str, also_fuzzy=None) -> list[tuple[str, object, object]] | None:
    """Exact, then prefix, then fuzzy, as (name, predicate, order) for one table.

    `also_fuzzy`, given the fold of the query, returns an extra fuzzy predicate and its score, such
    as a match inside a conversation's messages. None means the query is too short to search, and
    the list is then not filtered at all.
    """
    # Normalized by the same SQL function that built the stored key, so both sides fold alike
    normalized = session.scalar(select(func.norm(query[:100]))) or ""
    if len(normalized) < 2:
        return None
    session.execute(text("SET LOCAL statement_timeout = '3s'"))
    session.execute(text("SET LOCAL pg_trgm.word_similarity_threshold = 0.3"))
    key = func.fon(normalized)
    fuzzy = key.op("<%")(model.search_fon)
    score = func.word_similarity(key, model.search_fon)
    if also_fuzzy is not None:
        extra, extra_score = also_fuzzy(key)
        fuzzy = or_(fuzzy, extra)
        score = func.greatest(score, func.coalesce(extra_score, 0))
    latest = model.updated_at.desc()
    # normalized holds only letters, digits, and spaces, so it carries no LIKE wildcard
    return [
        ("exact", model.search_norm == normalized, latest),
        ("prefix", model.search_norm.like(f"{normalized}%"), latest),
        ("fuzzy", fuzzy, score.desc()),
    ]


def page_of(
    session: Session, base: Select, model, order, limit: int, offset: int, q: str | None = None, also_fuzzy=None
) -> dict:
    """One page of `base`, searched with the ladder when `q` is given. The first stage that finds
    rows answers, and its name comes back as `match` so the website can say when matches are close."""
    page = {"limit": limit, "offset": offset, "match": None}

    def run(where, order_by) -> tuple[int, list]:
        query = base.where(where) if where is not None else base
        total = session.scalar(select(func.count()).select_from(query.subquery()))
        items = session.scalars(query.order_by(*order_by, model.id).limit(limit).offset(offset)).all()
        return total, items

    stages = search_stages(session, model, q, also_fuzzy) if q else None
    if stages is None:
        total, items = run(None, order)
        return {**page, "items": items, "total": total}
    for match, where, stage_order in stages:
        total, items = run(where, [stage_order])
        if total:
            return {**page, "items": items, "total": total, "match": match}
    return {**page, "items": [], "total": 0}
