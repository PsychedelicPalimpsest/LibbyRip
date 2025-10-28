# LibbyRip

Rip all your favorite audiobooks from libby! 

<sup> Powered by [FFmpeg.js](https://github.com/PsychedelicPalimpsest/FFmpeg-js) </sup>

![Exporting audiobook](imgs/export.png)
![Showing chapters](imgs/chapters.png)

<sup>Be careful, I have had multiple library cards banned in the past from using this tool (See [#14](https://github.com/PsychedelicPalimpsest/LibbyRip/issues/14), [#12](https://github.com/PsychedelicPalimpsest/LibbyRip/issues/12), and [#8](https://github.com/PsychedelicPalimpsest/LibbyRip/issues/8) for more details) </sup>


## How to use

1. Install the [TamperMonkey](https://www.tampermonkey.net/) extension for your browser.
2. Install the userscript from the [GreasyFork page](https://greasyfork.org/en/scripts/498782-libregrab)
3. Find your audiobook on Libby and export.

**NOTE:** If you do not see anything, it _could_ be because TamperMonkey is not set up properly on Chrome (and chromeium based) browsers! See the TamperMonkey [FAQ](https://www.tampermonkey.net/faq.php#Q209) page here for more info.

<a href='https://ko-fi.com/V7V81BFLAH' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>


## Using the Python Script (`bakeMetadata.py`)

This repository includes a Python script that allows you to bake metadata into your downloaded audiobook MP3s, either via the command-line or a GUI.

### Script Requirements

Python 3.x is required, along with the dependencies listed in `requirements.txt`. Install them using:

```bash
pip install -r requirements.txt
```

### Running The Script

You can run the script in either **CLI mode** or **GUI mode**, depending on your needs:

#### Command-Line Mode

```bash
python bakeMetadata.py [<audiobook_directory>]
```

- If no directory is passed as an argument, you will be prompted to enter one.
- This mode is ideal for batch automation or terminal workflows.
- Output, progress, and errors will appear in the console.

#### GUI Mode

```bash
python bakeMetadata.py --gui [<audiobook_directory>]
```

- Launches a PyQt5 graphical interface.
- If no directory is passed, you'll be prompted to select one with a file dialog.
- All output and errors (including warnings like `Lame tag CRC check failed`) will be shown in a scrollable status window within the GUI instead of the terminal.
- Useful for users who prefer a more visual interface.

### What The Script Does

This script does the following:
- Loads the metadata exported with your audiobook from Libby (`metadata.json`).
- Embeds chapter information and cover art into each `Part *.mp3` file using the `eyed3` library.
- Sets ID3 tags including title, artist, album, and track number.

### Notes

- The audiobook directory **must** contain a `metadata` subdirectory with `metadata.json` and a cover image.
- The script assumes filenames follow the `Part X.mp3` naming convention.
- The message `Lame tag CRC check failed` is a **harmless warning** and can be safely ignored. It is now shown in the status window when using the GUI.

### Other Tools

A couple of utility scripts are included as well:

#### `buildChapters.py`

`buildChapters.py` can be used to help add chapter metadata to a *compiled* m4b file.

When concatenating all of the smaller `Part XXX.mp3` files together, chapter metadata is often lost or becomes less reliable.  This script writes chapter metadata to a file which can then be embeded using other tools.

**Usage**:

```bash
# Produce a chapters.txt file for use with m4b-tool and tone
python buildChapters.py --chapters < /path/to/audiobook/metadata/metadata.json > chapters.txt

# Produce an ffmetadata metadata.txt file for use with ffmpeg
python buildChapters.py --ffmpeg < /path/to/audiobook/metadata/metadata.json > metadata.txt
```

## Note on EPUBs
The EPUB downloader is **unstable**, and **unreliable**. It works with a majority of books, however Libby does some processing to the xhtml before it is sent to the client, so that needs repaired, and this is not perfect, in addition I have no experience with the EPUB format. I am always open to contributions, so if you find an issue and want to fix it, please do.


<hr>



**Disclaimer:** This tool is intended for educational and personal research purposes only. The developers do not condone or encourage any illegal activity, including the unauthorized distribution or reproduction of copyrighted content. By using this tool, you accept full responsibility for your actions and agree to comply with all applicable laws. Use at your own risk.
