#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print error messages
error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

# Function to print success messages
success() {
    echo -e "${GREEN}$1${NC}"
}

# Function to print info messages
info() {
    echo -e "${YELLOW}$1${NC}"
}

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    error "ffmpeg is not installed. Please install ffmpeg and try again."
fi

# Check if python is installed
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null; then
    error "python is not installed. Please install python and try again."
fi

# Determine python command
PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

# Check if buildChapters.py exists
if [ ! -f "buildChapters.py" ]; then
    error "buildChapters.py not found in current directory"
fi

# Check if input path is provided
if [ $# -eq 0 ]; then
    error "Usage: $0 <path-to-zip-or-folder>"
fi

INPUT_PATH="$1"

# Check if input exists
if [ ! -e "$INPUT_PATH" ]; then
    error "Input path does not exist: $INPUT_PATH"
fi

# Determine if input is a zip file or folder
TEMP_DIR=""
WORK_DIR=""
OUTPUT_NAME=""

if [ -f "$INPUT_PATH" ]; then
    # It's a file - check if it's a zip
    if [[ "$INPUT_PATH" =~ \.zip$ ]]; then
        info "Input is a zip file, extracting to temporary directory..."

        # Create temp directory
        TEMP_DIR=$(mktemp -d)

        # Extract zip
        unzip -q "$INPUT_PATH" -d "$TEMP_DIR"

        # Find the extracted folder (handle case where zip contains a single folder)
        EXTRACTED_ITEMS=("$TEMP_DIR"/*)
        if [ ${#EXTRACTED_ITEMS[@]} -eq 1 ] && [ -d "${EXTRACTED_ITEMS[0]}" ]; then
            WORK_DIR="${EXTRACTED_ITEMS[0]}"
        else
            WORK_DIR="$TEMP_DIR"
        fi

        # Get output name from zip filename (without .zip extension)
        OUTPUT_NAME=$(basename "$INPUT_PATH" .zip)

        success "Extracted to: $WORK_DIR"
    else
        error "Input file is not a zip file: $INPUT_PATH"
    fi
elif [ -d "$INPUT_PATH" ]; then
    # It's a directory
    WORK_DIR="$INPUT_PATH"
    OUTPUT_NAME=$(basename "$INPUT_PATH")
    info "Input is a directory: $WORK_DIR"
else
    error "Input is neither a file nor a directory: $INPUT_PATH"
fi

# Cleanup function
cleanup() {
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        info "Cleaning up temporary directory..."
        rm -rf "$TEMP_DIR"
    fi
}

# Register cleanup on exit
trap cleanup EXIT

# Step 2: Create metadata.txt file
info "Creating metadata.txt file..."

METADATA_JSON="$WORK_DIR/metadata/metadata.json"
METADATA_TXT="$WORK_DIR/metadata/metadata.txt"

if [ ! -f "$METADATA_JSON" ]; then
    error "metadata.json not found at: $METADATA_JSON"
fi

if ! "$PYTHON_CMD" buildChapters.py --ffmpeg < "$METADATA_JSON" > "$METADATA_TXT"; then
    error "Failed to create metadata.txt file"
fi

success "Created metadata.txt"

# Step 3: Identify highest bitrate of mp3 files
info "Analyzing mp3 files to find highest bitrate..."

HIGHEST_BITRATE=0

# Find all mp3 files in the work directory
while IFS= read -r -d '' mp3_file; do
    # Get bitrate using ffprobe
    BITRATE=$(ffprobe -v error -select_streams a:0 -show_entries stream=bit_rate -of default=noprint_wrappers=1:nokey=1 "$mp3_file" 2>/dev/null || echo "0")

    # Convert to integer (remove any non-numeric characters)
    BITRATE=${BITRATE//[^0-9]/}

    if [ -z "$BITRATE" ] || [ "$BITRATE" -eq 0 ]; then
        # If ffprobe doesn't return bitrate, try extracting from format
        BITRATE=$(ffprobe -v error -show_entries format=bit_rate -of default=noprint_wrappers=1:nokey=1 "$mp3_file" 2>/dev/null || echo "0")
        BITRATE=${BITRATE//[^0-9]/}
    fi

    if [ -n "$BITRATE" ] && [ "$BITRATE" -gt 0 ] && [ "$BITRATE" -gt "$HIGHEST_BITRATE" ]; then
        HIGHEST_BITRATE=$BITRATE
    fi
done < <(find "$WORK_DIR" -maxdepth 1 -name "*.mp3" -type f -print0)

if [ "$HIGHEST_BITRATE" -eq 0 ]; then
    error "No mp3 files found or unable to determine bitrate"
fi

success "Highest bitrate found: ${HIGHEST_BITRATE} bps ($(($HIGHEST_BITRATE / 1000)) kbps)"

# Step 4: Combine mp3 files into m4b
info "Converting to m4b format..."

OUTPUT_FILE="${OUTPUT_NAME}.m4b"

# Check if Part*.mp3 files exist
if ! ls "$WORK_DIR"/Part*.mp3 &> /dev/null; then
    error "No Part*.mp3 files found in: $WORK_DIR"
fi

# Create the m4b file
if ffmpeg -f concat -safe 0 -i <(find "$WORK_DIR" -maxdepth 1 -name "Part*.mp3" -type f | sort -V | while IFS= read -r file; do printf "file '%s'\n" "$file"; done) -i "$METADATA_TXT" -c:a aac -b:a "$HIGHEST_BITRATE" -map_metadata 1 -map_chapters 1 -f ipod "$OUTPUT_FILE" -y 2>&1 | grep -v "^frame="; then
    success "Successfully created: $OUTPUT_FILE"
else
    error "Failed to create m4b file"
fi

info "Conversion complete!"
