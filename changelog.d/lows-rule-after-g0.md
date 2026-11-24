### Process

- **Narrower rule for lows:** a reviewer files a low only when a user would notice it or it can give a wrong result, and each ledger line names its file so the next lane touching that file fixes it in passing. `status --planner` now lists a lows ledger for a sweep at 20 lines or when it holds a line older than a month (it was over 10 lines); a test keeps the lane and planner skills in step with that number (backlog `lows-rule-after-g0`).
