#!/usr/bin/env python3
"""
Landlock sandbox wrapper — restrict file writes to allowed directories.
Uses Linux Landlock LSM (kernel 5.13+) via ctypes. No dependencies.

Usage: landlock-sandbox.py --deny /path/to/deny --allow /path/to/allow -- command [args...]
"""
import ctypes
import ctypes.util
import os
import sys
import struct

# Landlock constants (from linux/landlock.h)
LANDLOCK_CREATE_RULESET_VERSION = 1 << 0

# ABI v1 (kernel 5.13)
LANDLOCK_ACCESS_FS_EXECUTE    = 1 << 0
LANDLOCK_ACCESS_FS_WRITE_FILE = 1 << 1
LANDLOCK_ACCESS_FS_READ_FILE  = 1 << 2
LANDLOCK_ACCESS_FS_READ_DIR   = 1 << 3
LANDLOCK_ACCESS_FS_REMOVE_DIR = 1 << 4
LANDLOCK_ACCESS_FS_REMOVE_FILE= 1 << 5
LANDLOCK_ACCESS_FS_MAKE_CHAR  = 1 << 6
LANDLOCK_ACCESS_FS_MAKE_DIR   = 1 << 7
LANDLOCK_ACCESS_FS_MAKE_REG   = 1 << 8
LANDLOCK_ACCESS_FS_MAKE_SOCK  = 1 << 9
LANDLOCK_ACCESS_FS_MAKE_FIFO  = 1 << 10
LANDLOCK_ACCESS_FS_MAKE_BLOCK = 1 << 11
LANDLOCK_ACCESS_FS_MAKE_SYM   = 1 << 12

LANDLOCK_RULE_PATH_BENEATH = 1

# All write-related access bits
ALL_WRITE_ACCESS = (
    LANDLOCK_ACCESS_FS_WRITE_FILE |
    LANDLOCK_ACCESS_FS_REMOVE_DIR |
    LANDLOCK_ACCESS_FS_REMOVE_FILE |
    LANDLOCK_ACCESS_FS_MAKE_CHAR |
    LANDLOCK_ACCESS_FS_MAKE_DIR |
    LANDLOCK_ACCESS_FS_MAKE_REG |
    LANDLOCK_ACCESS_FS_MAKE_SOCK |
    LANDLOCK_ACCESS_FS_MAKE_FIFO |
    LANDLOCK_ACCESS_FS_MAKE_BLOCK |
    LANDLOCK_ACCESS_FS_MAKE_SYM
)

ALL_ACCESS = ALL_WRITE_ACCESS | LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR

# Syscall numbers (x86_64)
SYS_landlock_create_ruleset = 444
SYS_landlock_add_rule = 445
SYS_landlock_restrict_self = 446

# aarch64 syscall numbers
if os.uname().machine == 'aarch64':
    SYS_landlock_create_ruleset = 444
    SYS_landlock_add_rule = 445
    SYS_landlock_restrict_self = 446


def landlock_available():
    """Check if Landlock is supported by the running kernel."""
    libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
    # Try ABI version check
    ret = libc.syscall(SYS_landlock_create_ruleset, None, 0, LANDLOCK_CREATE_RULESET_VERSION)
    if ret < 0:
        return False
    os.close(ret)
    return True


def create_ruleset(handled_access):
    """Create a Landlock ruleset."""
    libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
    # struct landlock_ruleset_attr { __u64 handled_access_fs; }
    attr = struct.pack('Q', handled_access)
    buf = ctypes.create_string_buffer(attr)
    fd = libc.syscall(SYS_landlock_create_ruleset, buf, len(attr), 0)
    if fd < 0:
        errno = ctypes.get_errno()
        raise OSError(errno, f"landlock_create_ruleset failed: {os.strerror(errno)}")
    return fd


def add_path_rule(ruleset_fd, allowed_access, path):
    """Add a path-beneath rule to the ruleset."""
    libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
    path_fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    try:
        # struct landlock_path_beneath_attr { __u64 allowed_access; __s32 parent_fd; __u32 padding; }
        attr = struct.pack('QiI', allowed_access, path_fd, 0)
        buf = ctypes.create_string_buffer(attr)
        ret = libc.syscall(SYS_landlock_add_rule, ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, buf, 0)
        if ret < 0:
            errno = ctypes.get_errno()
            raise OSError(errno, f"landlock_add_rule failed for {path}: {os.strerror(errno)}")
    finally:
        os.close(path_fd)


def restrict_self(ruleset_fd):
    """Apply the ruleset to the current process."""
    libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
    # Drop "no new privs" requirement
    PR_SET_NO_NEW_PRIVS = 38
    libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
    ret = libc.syscall(SYS_landlock_restrict_self, ruleset_fd, 0)
    if ret < 0:
        errno = ctypes.get_errno()
        raise OSError(errno, f"landlock_restrict_self failed: {os.strerror(errno)}")


def main():
    args = sys.argv[1:]
    deny_paths = []
    allow_paths = []
    cmd_start = -1

    i = 0
    while i < len(args):
        if args[i] == '--deny':
            deny_paths.append(os.path.realpath(args[i + 1]))
            i += 2
        elif args[i] == '--allow':
            allow_paths.append(os.path.realpath(args[i + 1]))
            i += 2
        elif args[i] == '--':
            cmd_start = i + 1
            break
        else:
            i += 1

    if cmd_start < 0 or cmd_start >= len(args):
        print("Usage: landlock-sandbox.py --deny /path --allow /path -- command [args...]", file=sys.stderr)
        sys.exit(1)

    command = args[cmd_start:]

    if not landlock_available():
        print("[landlock] Not available on this kernel, running without sandbox", file=sys.stderr)
        os.execvp(command[0], command)
        return

    try:
        # Create ruleset that handles all filesystem access
        ruleset_fd = create_ruleset(ALL_ACCESS)

        # Allow read+execute everywhere (we only want to restrict writes)
        read_only = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR
        add_path_rule(ruleset_fd, read_only, '/')

        # Allow full access to allowed paths (worktree, tmp, etc.)
        for p in allow_paths:
            if os.path.exists(p):
                add_path_rule(ruleset_fd, ALL_ACCESS, p)

        # Allow full access to common writable dirs
        for d in ['/tmp', '/dev', os.path.expanduser('~/.npm'), os.path.expanduser('~/.bun'),
                   os.path.expanduser('~/.nvm'), os.path.expanduser('~/.cache'),
                   os.path.expanduser('~/.config')]:
            if os.path.exists(d):
                add_path_rule(ruleset_fd, ALL_ACCESS, d)

        # Restrict self
        restrict_self(ruleset_fd)
        os.close(ruleset_fd)

        print(f"[landlock] Sandbox active: writes blocked except {allow_paths}", file=sys.stderr)

    except OSError as e:
        print(f"[landlock] Setup failed ({e}), running without sandbox", file=sys.stderr)

    # Replace process with command
    os.execvp(command[0], command)


if __name__ == '__main__':
    main()
