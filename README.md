# Voice Technitos
Voice Technitos is a GUI for using the local AI models Omnivoice and PocketTTS designed to be used to manage your cloned voices.

>[!IMPORTANT]
>This app was made with the help of the following AI coding tools:
> - OpenCode with the BigPickle model.

# Table of Content
- [Features](#features)
- [Installation](#installation)
- [Voice Library](#voice-library)
- [History](#history)
- [Configuration](#configuration)
- [Screenshots](#screenshots)

# Features
- Support for both linux and Windows.
- Support for local AI models "Omnivoice" and "PocketTTS".
- Full parameter configurations for both AI models.
- Automatic download and setup of the AI models.
- A library to create and manage your cloned voices.
- A history section to see your past generation.

# Installation

## Easy Install
Just download the latest windows or linux zip depending on your system.

>[!NOTE]
> The Linux version is only tested on CachyOS, dont be surprised if it doesnt run on your distro.

## Manual Installation (development)

Dependencies:
  - python 3.11
  - git
1. Download python 3.11. **For Linux** You can use a python version manager like [Pyenv](https://github.com/pyenv/pyenv#linuxunix).
2. Git clone this repository and cd into the cloned directory.
3. Install dependencies of the requirements.txt with:
``` python
pip install -r requirements.txt   
```
4. Launch the MainGUI.py with:
``` python
python MainGUI.py
```

# Voice Library
Voice Technitos main feature is a voice library of your clones voices, to keep them organized and easily accessible.
You can add edit and delete voices.

<img width="598" height="793" alt="image" src="https://github.com/user-attachments/assets/fbdee526-1687-41c5-83fb-654ba51fdadb" />

Voices are stored inside the data folder called "Voice Library".
Voices are searchable

# History
History allows you to view, listen and save your past generations.

<img width="557" height="831" alt="image" src="https://github.com/user-attachments/assets/3859ee97-c597-4b91-9d73-7fc596185d47" />

You can delete your entire history or select individual entries to delete.
History is stored inside the data folder calles "output"
History is searchable.

# Configuration
The program will let you choose at startup which model you want to use, either "Omnivoice" or "PocketTTS" then the selected model will be downloaded from hugging face and initialized. 

>[!NOTE]
> Models are stored in:
> "/home/user/.cache/huggingface/hub/" for linux.
> "C:\Users\user\.cache\huggingface\hub" for windows

You can configure the speed, gain, output format and sample rate of the audio.

For model configuration you can change every parameter of each model the program gives you a quick tip of what it does, if you want a more detailed explanation then go to either:
- [Omnivoice parameters docs](https://github.com/k2-fsa/OmniVoice/blob/master/docs/generation-parameters.md)
- [PocketTTS API docs](https://github.com/kyutai-labs/pocket-tts/blob/main/docs/API%20Reference/python-api.md)

# Screenshots

<img width="1485" height="1103" alt="image" src="https://github.com/user-attachments/assets/772e23fa-d626-4f65-8611-37b1ea0590b2" />

<img width="1485" height="1103" alt="image" src="https://github.com/user-attachments/assets/793ea9d9-5d62-4c52-b812-03a89c00fda0" />

<img width="1492" height="1178" alt="image" src="https://github.com/user-attachments/assets/127a6e4a-2d1d-49f4-b262-2fd5f9e5a256" />






