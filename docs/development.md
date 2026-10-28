# Continue development

## Clone and run

```powershell
git clone https://github.com/Thekingofhe11/CodeMentorAI.git
cd CodeMentorAI
npm.cmd ci
npm.cmd run build
python -m venv backend\venv
backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Only copy the environment example for a fresh checkout; do not overwrite an existing `backend/.env`. Add your own provider key there, or leave keys blank for curated demo mode. Real keys are never tracked in Git.

Start the backend:

```powershell
backend\venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In another terminal, start the local practice page:

```powershell
backend\venv\Scripts\python.exe tools\preview.py
```

Visit <http://127.0.0.1:4173/problems/two-sum/>. If the port is occupied, pass `--port 4174`. For the real extension, load the `extension` folder in Chrome's extension developer mode. Reload its card and refresh LeetCode after changing extension files.

## Save future updates

Start each feature from a clean working tree:

```powershell
git pull --ff-only
git switch -c feature/your-change
```

After editing, build and check the project:

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
backend\venv\Scripts\python.exe -m unittest discover -s backend -v
git status
git diff
git add .
git diff --cached --stat
git commit -m "Describe the change"
git push -u origin HEAD
```

Create a pull request on GitHub, review it, and merge when ready. The repository runs the build and tests on every push and pull request. Automated tests use mocked provider responses and do not need API keys.

Commit `package-lock.json` when dependencies change. Rebuild and commit `extension/assets/` when changing the visual source, so an unpacked extension works immediately after cloning. Keep upstream license notices with those assets. Do not commit `.env`, local logs, dependencies, or virtual environments.

## Make and restore a backup

From the project folder, choose an existing backup directory outside the checkout:

```powershell
git bundle create ..\CodeMentorAI-backup.bundle --all
git bundle verify ..\CodeMentorAI-backup.bundle
git archive --format=zip --output=..\CodeMentorAI-source.zip HEAD
```

A bundle preserves all committed branches, tags, and history. The ZIP preserves the current committed source. Neither includes uncommitted changes or ignored files such as API keys. Commit the work you want to preserve before making a backup, and store a copy on a separate drive or backup service.

Restore history into a new directory:

```powershell
git clone -b main ..\CodeMentorAI-backup.bundle CodeMentorAI-restored
cd CodeMentorAI-restored
git remote set-url origin https://github.com/Thekingofhe11/CodeMentorAI.git
git fetch origin
```

Then follow the setup commands above to recreate dependencies and configure the backend. Keep any separate configuration backup private; do not upload it to this public repository.
