from __future__ import annotations
import json, random, shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

ACTIVE_POOL_SIZE = 20

GRADUATION_SCORE = 2.4

MIN_REVIEWS_TO_GRADUATE = 4

EMA_NEW_WEIGHT = 0.30

LEARNING_CARDS_PER_LEARNED_CARD = 4

TRACK_FLASHCARDS = "flashcards"

TRACK_LISTENING = "listening"

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()

def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None

def default_settings() -> dict:
    return {"learning_cards_since_review": 0, "review_everything": False}

def fresh_document(deck_name: str) -> dict:
    return {
        "version": 3,
        "deck": deck_name,
        "saved_at": iso(now_utc()),
        "tracks": {
            TRACK_FLASHCARDS: {"settings": default_settings(), "cards": {}},
            TRACK_LISTENING: {"settings": default_settings(), "cards": {}},
        },
    }

class ProgressStore:
    """One JSON per deck, with separate learning tracks for flashcards and listening."""

    def __init__(self, path: Path, deck_name: str):
        self.path = path
        self.deck_name = deck_name
        self.document = self._load()

    def _load(self) -> dict:
        if not self.path.exists():
            return fresh_document(self.deck_name)
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            backup = self.path.with_suffix(".broken.json")
            try:
                shutil.copy2(self.path, backup)
            except OSError:
                pass
            return fresh_document(self.deck_name)

        # Migrate the old v2 single-track format without losing any progress.
        if isinstance(data.get("cards"), dict) and "tracks" not in data:
            doc = fresh_document(self.deck_name)
            doc["tracks"][TRACK_FLASHCARDS] = {
                "settings": data.get("settings", default_settings()),
                "cards": data.get("cards", {}),
            }
            return doc

        if not isinstance(data.get("tracks"), dict):
            return fresh_document(self.deck_name)

        data["version"] = 3
        data["deck"] = self.deck_name
        for track_name in (TRACK_FLASHCARDS, TRACK_LISTENING):
            track = data["tracks"].setdefault(track_name, {})
            track.setdefault("settings", default_settings())
            track.setdefault("cards", {})
        return data

    def track(self, name: str) -> dict:
        return self.document["tracks"][name]

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.document["saved_at"] = iso(now_utc())
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.document, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)

class Scheduler:
    def __init__(self, cards: list[dict[str, str]], store: ProgressStore, track_name: str):
        self.cards = cards
        self.store = store
        self.track_name = track_name
        self.track = store.track(track_name)
        self.state: dict[str, dict] = self.track["cards"]
        settings = self.track["settings"]
        self.current_word: str | None = None
        self.session_answers = 0
        self.learning_cards_since_review = max(0, int(settings.get("learning_cards_since_review", 0)))
        self.review_everything = bool(settings.get("review_everything", False))
        self._initialize_cards()
        self._fill_learning_pool()
        self.save()

    def _default_state(self, status: str = "unseen") -> dict:
        return {
            "status": status,
            "score": 1.5,
            "reviews": 0,
            "interval_days": 0.0,
            "due_at": None,
            "last_seen_at": None,
            "ratings": [0, 0, 0, 0],
        }

    def _initialize_cards(self) -> None:
        valid_words = {card["word"] for card in self.cards}
        self.state = {word: value for word, value in self.state.items() if word in valid_words}
        for word in valid_words:
            base = self._default_state()
            saved = self.state.get(word, {})
            base.update({key: value for key, value in saved.items() if key in base})
            self.state[word] = base
        self.track["cards"] = self.state

    def save(self) -> None:
        self.track["settings"] = {
            "learning_cards_since_review": self.learning_cards_since_review,
            "review_everything": self.review_everything,
        }
        self.track["cards"] = self.state
        self.store.save()

    def _fill_learning_pool(self) -> None:
        learning = [word for word, data in self.state.items() if data["status"] == "learning"]
        needed = max(0, ACTIVE_POOL_SIZE - len(learning))
        unseen = [word for word, data in self.state.items() if data["status"] == "unseen"]
        for word in random.sample(unseen, min(needed, len(unseen))):
            self.state[word] = self._default_state("learning")

    def _due_review_words(self) -> list[str]:
        now = now_utc()
        return [
            word
            for word, data in self.state.items()
            if data["status"] == "review"
            and (parse_time(data.get("due_at")) is None or parse_time(data.get("due_at")) <= now)
        ]

    def _weighted_choice(self, candidates: list[str]) -> str:
        if len(candidates) > 1 and self.current_word in candidates:
            candidates = [word for word in candidates if word != self.current_word]

        return random.choice(candidates)

    def next_word(self) -> str:
        learning = [word for word, data in self.state.items() if data["status"] == "learning"]
        learned = [word for word, data in self.state.items() if data["status"] == "review"]
        due = self._due_review_words()

        if self.review_everything:
            candidates = learning + learned
        elif learned and self.learning_cards_since_review >= LEARNING_CARDS_PER_LEARNED_CARD:
            candidates = due or learned
            self.learning_cards_since_review = 0
        elif learning:
            candidates = learning
            if learned:
                self.learning_cards_since_review += 1
        else:
            candidates = due or learned

        if not candidates:
            raise RuntimeError("There are no cards available.")
        self.current_word = self._weighted_choice(candidates)
        return self.current_word

    def answer(self, rating: int) -> None:
        if self.current_word is None or rating not in range(4):
            return
        data = self.state[self.current_word]
        previous_score = float(data["score"])
        if int(data["reviews"]) == 0:
            score = float(rating)
        else:
            score = (1 - EMA_NEW_WEIGHT) * previous_score + EMA_NEW_WEIGHT * rating
        data["score"] = round(max(0.0, min(3.0, score)), 4)
        data["reviews"] = int(data["reviews"]) + 1
        ratings = list(data.get("ratings", [0, 0, 0, 0]))
        ratings[rating] += 1
        data["ratings"] = ratings
        data["last_seen_at"] = iso(now_utc())
        self.session_answers += 1

        was_review = data["status"] == "review"
        due_at = parse_time(data.get("due_at"))
        was_due = was_review and (due_at is None or due_at <= now_utc())
        if rating == 0:
            data["status"] = "learning"
            data["interval_days"] = 0.0
            data["due_at"] = None
        elif data["reviews"] >= MIN_REVIEWS_TO_GRADUATE and data["score"] >= GRADUATION_SCORE:
            data["status"] = "review"
            old_interval = max(0.0, float(data.get("interval_days", 0.0)))
            if not was_review or old_interval == 0:
                interval = {1: 1.0, 2: 2.0, 3: 4.0}[rating]
            elif was_due:
                interval = old_interval * {1: 1.25, 2: 2.0, 3: 2.8}[rating]
            else:
                interval = None
            if interval is not None:
                data["interval_days"] = round(min(180.0, interval), 2)
                data["due_at"] = iso(now_utc() + timedelta(days=interval))

        self._fill_learning_pool()
        self.save()

    def stats(self) -> dict[str, int]:
        counts = {"learning": 0, "review": 0, "unseen": 0}
        for data in self.state.values():
            counts[data["status"]] = counts.get(data["status"], 0) + 1
        counts["due"] = len(self._due_review_words())
        return counts

    def reset(self) -> None:
        self.state = {card["word"]: self._default_state() for card in self.cards}
        self.current_word = None
        self.session_answers = 0
        self.learning_cards_since_review = 0
        self.review_everything = False
        self._fill_learning_pool()
        self.save()

    def set_review_everything(self, enabled: bool) -> None:
        self.review_everything = enabled
        self.save()
