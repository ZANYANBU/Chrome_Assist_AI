[![CI](https://github.com/ZANYANBU/Chrome_Assist_AI/actions/workflows/ci.yml/badge.svg)](https://github.com/ZANYANBU/Chrome_Assist_AI/actions/workflows/ci.yml)

# Contributing to ZANYSURF

First off — thank you. Every contribution matters.

## Ways to contribute (no code needed)
- ⭐ Star the repo — helps more than you think
- 🐛 Report bugs via Issues
- 💡 Suggest features via Discussions
- 🧪 Test on your machine and share results
- 📣 Share with people who'd find it useful

## Ways to contribute (code)
- Fix a bug from the Issues list
- Improve documentation
- Add a new LLM provider
- Add a new site-specific hint
- Improve test coverage

## Development setup
```bash
git clone https://github.com/ZANYANBU/Chrome_Assist_AI
cd Chrome_Assist_AI
npm install
npm test           # must show 15/15 passing
```

Load `extension/` folder in Chrome developer mode.

## Rules
1. Always sync root ↔ extension/ (identical files)
2. Run `npm test` before opening a PR
3. One feature/fix per PR
4. Commit format: `feat:`, `fix:`, `docs:`, `test:`

## PR checklist
- [ ] Tests pass (15/15)
- [ ] Root and extension/ are synced
- [ ] I tested in Chrome manually
- [ ] Description explains what and why

Built by Anbu Chelvan Valavan. 
Open to all contributors. MIT licensed.