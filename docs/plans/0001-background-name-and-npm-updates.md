# Background Activity Naming & NPM Global Updates

## 1. NPM Global Updates (Major vs. Minor)

**Context:** The `nightly.js` script iterates over `manifest.npmGlobals` from `packages.json` and runs `npm install --global <package>`. When a package is defined simply by its name (e.g., `"eslint"`), npm resolves to the `@latest` tag, which causes global packages to jump across major version boundaries.

**Problem:** Pulling in breaking major versions automatically can destabilize the macOS baseline and cause toolchain breakages without user opt-in. 

**Proposed Solutions (to defer):**
*   **Enforce SemVer in Manifest:** Update the project conventions to mandate that any entry in `npmGlobals` must include a semver constraint (e.g., `"eslint@^8.0.0"`). `nightly.js` can assert the presence of an `@` symbol and fail if the package is untagged.
*   **Switch to `npm update`:** Change the command in `nightly.js` from `npm install --global <package>` to `npm update --global <package>`. This respects existing installations and only bumps to the latest minor/patch.
*   **Dynamic Constraint Detection:** Have `nightly.js` query the currently installed version (`npm ls -g --depth=0 <package>`), extract the major version, and dynamically execute `npm install --global <package>@^<major>`.

## 2. macOS Background Activity Attribution

**Context:** The nightly schedule is installed via a launchd plist (`com.mac-bootstrap.nightly.plist`) that triggers automatically.

**Problem:** Under macOS Settings → General → Login Items & Extensions → "Allow in the Background", the item appears as "Node.js Foundation" or simply "node". The system Background Task Manager derives this display name directly from the code signature of the executable launched (Volta's `node` binary), ignoring the `Label` defined in the `.plist`.

**Proposed Solutions (to defer):**
*   **Compiled Wrapper Binary:** Write a tiny compiled CLI wrapper (in Swift, Go, or Rust) named `mac-bootstrap` that spawns the Node CLI. This wrapper must be code-signed with a valid Apple Developer ID. When `launchd` triggers the wrapper, macOS will read the certificate and attribute the background task to the signing developer / "mac-bootstrap".
*   **App Bundle Registration:** Wrap the CLI in a minimal macOS `.app` bundle with an `Info.plist`, which forces the Background Task Manager to associate the job with the App's bundle identifier.

Both approaches significantly increase distribution complexity (requiring compiled binaries and Apple Developer certificates) and are deferred for now.
