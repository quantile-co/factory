#!/usr/bin/env python3
"""Payload-free snapshots of the tracer and all its tracees, including builders."""

import json
import os
from pathlib import Path
import stat
import sys
import time


def process_stat(path):
    text = path.read_text()
    # comm may contain spaces or parentheses; never emit command arguments.
    fields = text[text.rfind(")") + 2 :].split()
    return {
        "comm": text[text.find("(") + 1 : text.rfind(")")],
        "state": fields[0],
        "ppid": int(fields[1]),
        "pgrp": int(fields[2]),
        "user_ticks": int(fields[11]),
        "system_ticks": int(fields[12]),
        "start_ticks": int(fields[19]),
        "rss_pages": int(fields[21]),
    }


def snapshot(group):
    result = {"time": time.time(), "process_group": group, "processes": []}
    for proc in Path("/proc").iterdir():
        if not proc.name.isdecimal():
            continue
        try:
            info = process_stat(proc / "stat")
            tracer = next(
                int(line.split()[1])
                for line in (proc / "status").read_text().splitlines()
                if line.startswith("TracerPid:")
            )
            # Nix builders call setsid: process-group membership alone misses them.
            if info["pgrp"] != group and tracer != group:
                continue
            info["pid"] = int(proc.name)
            info["tracer_pid"] = tracer
            result["processes"].append(info)
            try:
                info["io"] = {
                    key: int(value)
                    for line in (proc / "io").read_text().splitlines()
                    for key, value in [line.split(":", 1)]
                }
            except OSError as error:
                info["io_error"] = type(error).__name__
            info["threads"] = []
            for task in (proc / "task").iterdir():
                try:
                    thread = process_stat(task / "stat")
                    thread["tid"] = int(task.name)
                    thread["wchan"] = (task / "wchan").read_text().strip()
                    info["threads"].append(thread)
                except (OSError, ValueError, IndexError):
                    pass  # Threads can exit during the snapshot.
            info["fds"] = []
            sockets = set()
            for fd in (proc / "fd").iterdir():
                try:
                    target = os.readlink(fd)
                    mode = fd.stat().st_mode
                    entry = {"fd": int(fd.name)}
                    if target.startswith("socket:["):
                        inode = target[8:-1]
                        sockets.add(inode)
                        entry.update(kind="socket", inode=inode)
                    elif stat.S_ISFIFO(mode):
                        entry["kind"] = "pipe"
                    elif stat.S_ISREG(mode):
                        entry["kind"] = "file"
                    else:
                        entry["kind"] = "other"
                    # Do not emit file names, pipe contents or arbitrary symlinks.
                    info["fds"].append(entry)
                except OSError:
                    pass
            info["tcp"] = []
            for family in ("tcp", "tcp6"):
                for line in (proc / "net" / family).read_text().splitlines()[1:]:
                    fields = line.split()
                    if fields[9] in sockets:
                        info["tcp"].append({
                            "family": family,
                            "local": fields[1],
                            "remote": fields[2],
                            "state": fields[3],
                            "tx_rx_queue_hex": fields[4],
                            "timer_hex": fields[5],
                            "retransmits_hex": fields[6],
                            "inode": fields[9],
                        })
        except (OSError, ValueError, IndexError, StopIteration):
            pass  # Process exit/access races must not interrupt the workload.
    return result


if __name__ == "__main__":
    print(json.dumps(snapshot(int(sys.argv[1])), separators=(",", ":")))
