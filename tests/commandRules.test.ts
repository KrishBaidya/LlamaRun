import { describe, expect, it } from 'vitest'
import { decide, hardline, matchesPattern, proposeRules, splitCommands } from '../src/main/assistant/commandRules'

describe('command rules (like OpenCode permissions)', () => {
  it('splits a command line into its parts, leaving quoted text whole', () => {
    expect(splitCommands('cd out; python make.py && echo done')).toEqual(['cd out', 'python make.py', 'echo done'])
    expect(splitCommands('python -c "print(1); print(2)" | more')).toEqual(['python -c "print(1); print(2)"', 'more'])
    expect(splitCommands("echo 'a && b' || exit 1")).toEqual(["echo 'a && b'", 'exit 1'])
  })

  it('matches whole commands with * wildcards; "x *" also matches x alone', () => {
    expect(matchesPattern('python *', 'python -c "import reportlab"')).toBe(true)
    expect(matchesPattern('python *', 'python')).toBe(true)
    expect(matchesPattern('python *', 'pythonw evil.py')).toBe(false)
    expect(matchesPattern('git status *', 'git status --short')).toBe(true)
    expect(matchesPattern('git status *', 'git push')).toBe(false)
    expect(matchesPattern('Get-ChildItem *', 'get-childitem C:\\')).toBe(true)
  })

  it('runs a command only when every part is allowed; a block rule wins', () => {
    const rules = [
      { pattern: 'python *', effect: 'allow' as const },
      { pattern: 'git push *', effect: 'deny' as const },
      { pattern: 'git *', effect: 'allow' as const }
    ]
    expect(decide('python make_pdf.py', rules)).toEqual({ effect: 'allow' })
    expect(decide('python make_pdf.py; curl https://x.example', rules)).toEqual({ effect: 'ask' })
    expect(decide('git add . && git push origin main', rules)).toEqual({ effect: 'deny', rule: 'git push *' })
    expect(decide('cd out', rules, ['cd *'])).toEqual({ effect: 'allow' })
    expect(decide('anything', [])).toEqual({ effect: 'ask' })
  })

  it('always asks before commands that can wipe a disk or the system, whatever the rules say', () => {
    const everything = [{ pattern: '*', effect: 'allow' as const }]
    for (const command of ['format D: /q', 'diskpart', 'shutdown /s /t 0', 'Remove-Item -Recurse -Force C:\\', 'rm -rf ~', 'reg delete HKLM\\Software\\X /f', 'Remove-Item -Recurse $env:USERPROFILE']) {
      expect(decide(command, everything).effect, command).toBe('ask')
      expect(hardline(command), command).not.toBeNull()
    }
    // Ordinary deletes inside a folder are up to the rules.
    expect(hardline('Remove-Item -Recurse .\\build')).toBeNull()
    expect(decide('python -c "print(1)"', everything)).toEqual({ effect: 'allow' })
  })

  it('proposes a rule per part for "Always allow": the program, or the program and its subcommand', () => {
    expect(proposeRules('python -c "import reportlab"')).toEqual(['python *'])
    expect(proposeRules('git status --short')).toEqual(['git status *'])
    expect(proposeRules('cd out; npm run build')).toEqual(['cd *', 'npm run *'])
    expect(proposeRules('& "C:\\Tools\\magick.exe" in.png out.jpg')).toEqual(['& "C:\\Tools\\magick.exe" *'])
    // Parts already allowed need no new rule.
    expect(proposeRules('cd out; python a.py', [{ pattern: 'cd *', effect: 'allow' }])).toEqual(['python *'])
  })
})
