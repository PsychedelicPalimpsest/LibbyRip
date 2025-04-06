# LibbyRip

Rip all your favorite audiobooks from libby! 

<sup> Powered by [FFmpeg.js](https://github.com/PsychedelicPalimpsest/FFmpeg-js) </sup>

![Exporting audiobook](imgs/export.png)
![Showing chapters](imgs/chapters.png)

<sup>Be careful, I have had multiple library cards banned in the past from using this tool (See [#14](https://github.com/PsychedelicPalimpsest/LibbyRip/issues/14), [#12](https://github.com/PsychedelicPalimpsest/LibbyRip/issues/12), and [#8](https://github.com/PsychedelicPalimpsest/LibbyRip/issues/8) for more details) </sup>

## Using the Python Script (`bakeMetadata.py`)

This repository includes a Python script that allows you to bake metadata into your downloaded audiobook MP3s, either via the command-line or a GUI.

### Requirements

Python 3.x is required, along with the dependencies listed in `requirements.txt`. Install them using:

```
pip install -r requirements.txt
```

### Running the Script

You can run the script in either **CLI mode** or **GUI mode**, depending on your needs:

#### Command-Line Mode

```
python bakeMetadata.py [<audiobook_directory>]
```

- If no directory is passed as an argument, you will be prompted to enter one.
- This mode is ideal for batch automation or terminal workflows.
- Output, progress, and errors will appear in the console.

#### GUI Mode

```
python bakeMetadata.py --gui [<audiobook_directory>]
```

- Launches a PyQt5 graphical interface.
- If no directory is passed, you'll be prompted to select one with a file dialog.
- All output and errors (including warnings like `Lame tag CRC check failed`) will be shown in a scrollable status window within the GUI instead of the terminal.
- Useful for users who prefer a more visual interface.

### What It Does

This script does the following:
- Loads the metadata exported with your audiobook from Libby (`metadata.json`).
- Embeds chapter information and cover art into each `Part *.mp3` file using the `eyed3` library.
- Sets ID3 tags including title, artist, album, and track number.

### Notes

- The audiobook directory **must** contain a `metadata` subdirectory with `metadata.json` and a cover image.
- The script assumes filenames follow the `Part X.mp3` naming convention.
- The message `Lame tag CRC check failed` is a **harmless warning** and can be safely ignored. It is now shown in the status window when using the GUI.

## Note on EPUBs
The EPUB downloader is **unstable**, and **unreliable**. It works with a majority of books, however Libby does some processing to the xhtml before it is sent to the client, so that needs repaired, and this is not perfect, in addition I have no experience with the EPUB format. I am always open to contributions, so if you find an issue and want to fix it, please do.


<hr>



**Disclaimer:** This tool is intended for educational and personal research purposes only. The developers do not condone or encourage any illegal activity, including the unauthorized distribution or reproduction of copyrighted content. By using this tool, you accept full responsibility for your actions and agree to comply with all applicable laws. Use at your own risk.
