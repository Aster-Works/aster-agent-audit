**What & why**
A short description of the change and the problem it solves.

**Checklist**
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck:all` is clean
- [ ] New non-trivial logic has a test
- [ ] Secrets stay redacted before storage; commands are only inspected, never executed
- [ ] Any hook/config edit backs up first and restores on uninstall
- [ ] The local server remains `127.0.0.1`-only

**Notes for the reviewer**
