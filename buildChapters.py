from dataclasses import dataclass
from datetime import timedelta
import json
import re
import sys
from typing import Any, List


@dataclass(frozen=True)
class Chapter:
    title: str
    "The title of the chapter"

    total_offset: timedelta
    "The offset from the start of the audiobook at which the chapter begins"


@dataclass(frozen=True)
class Metadata:
    title: str
    "The title of the audiobook"

    author: str | None
    "The author of the audiobook, if available"

    narrator: str | None
    "The narrator of the audiobook, if available"

    total_duration: timedelta
    "The total length of the audiobook"

    chapters: List[Chapter]
    "A list of all the chapters in the audiobook"

    def from_json(metadata: Any) -> 'Metadata':
        """Extracts a list of chapters from raw Libby metadata

        Given libby metadata in the form of a JSON object parsed from
        metadata.json, produce a list of Chapters.
        """
        spines = metadata[
            "spine"
        ]  # Array of objects with the properties duration, type, bitrate
        chapters = metadata[
            "chapters"
        ]  # Array of objects with the properties title, spine, offset

        spine_offsets = [
            sum(spine["duration"] for spine in spines[:spine_index])
            for spine_index in range(len(spines))
        ]

        chapters = [
            Chapter(
                chapter["title"],
                timedelta(
                    seconds=chapter["offset"] + spine_offsets[chapter["spine"]]
                ),
            )
            for chapter in chapters
        ]

        contributors = {
            creator["role"]: creator["name"]
            for creator in metadata["creator"]
        }

        return Metadata(
            title=metadata["title"],
            narrator=contributors.get("narrator"),
            author=contributors.get("author"),
            total_duration=timedelta(
                seconds=sum(spine["duration"] for spine in spines)
            ),
            chapters=chapters,
        )


def format_timedelta(d):
    "Convert a timedelta into a string in the format used by chapters.txt"
    millis = int(d.microseconds // 1000)
    seconds = int(d.total_seconds() % 60)
    minutes = int((d.total_seconds() // 60) % 60)
    hours = int((d.total_seconds() // 3600))
    return f"{hours:02}:{minutes:02}:{seconds:02}.{millis:03}"


def metadata_to_chapters_txt(metadata: Metadata) -> str:
    "Convert metadata into a string formatted for chapters.txt"
    return "\n".join(
        f"{format_timedelta(chapter.total_offset)} {chapter.title}"
        for chapter in metadata.chapters
    )


ffmetadata_special_characters = re.compile(r"(=|;|#|\\|\n)")


def escape_for_ffmetadata(input: str) -> str:
    "Return a string escaped for use in an ffmetadata file"
    return ffmetadata_special_characters.sub(r"\\\1", input)


def metadata_to_ffmpeg(metadata: Metadata) -> str:
    "Convert metadata into FFMPEG's ffmetadata format"
    def format_chapter_timestamp(chapter):
        return int(
            chapter.total_offset.total_seconds() * 1000
        )
    title_line = f"title={escape_for_ffmetadata(metadata.title)}\n"
    author_line = (
        f"artist={escape_for_ffmetadata(metadata.author)}\n"
        if metadata.author else ""
    )
    chapters_part = "\n".join(
        (
            "[CHAPTER]\n"
            "TIMEBASE=1/1000\n"
            f"START={format_chapter_timestamp(chapter)}\n"
            f"END={format_chapter_timestamp(next_chapter)}\n"
            f"title={escape_for_ffmetadata(chapter.title)}\n"
        )
        for (chapter, next_chapter)
        in zip(
           metadata.chapters,
           metadata.chapters[1:] + [Chapter("END", metadata.total_duration)]
        )
    )
    return f";FFMETADATA1\n{title_line}{author_line}\n{chapters_part}"


if __name__ == "__main__":
    if len(sys.argv) == 1 or sys.argv[1] == "--chapters":
        format = metadata_to_chapters_txt
    elif sys.argv[1] == "--ffmpeg":
        format = metadata_to_ffmpeg
    else:
        print(
            f"Usage: {sys.argv[0]} [--chapters | --ffmpeg]"
            " < metadata.json > chapters.txt"
        )
        exit(1)

    raw_metadata = json.load(sys.stdin)
    metadata = Metadata.from_json(raw_metadata)

    print(format(metadata))
