# PR #2777 (showme-ui) — were the "update branch" rebuilds necessary by the board's rule?

Question: of the merges from `main` into the branch, how many pulled in a `main` commit that
touched a file the PR touched? File-level overlap is the rule `whipple3 pr check` applies.

```bash
gh pr view 2777 --json files --jq '.files[].path' | sort > pr-files
git fetch origin refs/pull/2777/head:refs/pr/2777
for m in 97f753a4 30289147 b733072a adb0aca5 9db4529b 47470c3a a179ebb6 aa1d3673 8fa31266 9f7394b7 46fb827e; do
  base=$(git merge-base $m^1 $m^2)
  echo "$m main-commits=$(git rev-list --count $base..$m^2) \
overlap=[$(comm -12 pr-files <(git diff --name-only $base $m^2 | sort) | tr '\n' ' ')]"
done
```

Raw output (times are the merge commits' committer dates, local +03:00 on 09-05):

```
97f753a4 09-02T18:28 main-commits=3  files=19  overlap=[src/pages/admin/seatMapBuilder/threeDMount.ts]
30289147 09-02T18:55 main-commits=3  files=13  overlap=[]
b733072a 09-02T19:58 main-commits=1  files=9   overlap=[]
adb0aca5 09-02T20:23 main-commits=5  files=1   overlap=[]
9db4529b 09-05T14:34 main-commits=53 files=462 overlap=[]
47470c3a 09-05T14:37 main-commits=1  files=5   overlap=[]
a179ebb6 09-05T14:42 main-commits=1  files=7   overlap=[]
aa1d3673 09-05T14:48 main-commits=1  files=3   overlap=[]
8fa31266 09-05T14:53 main-commits=1  files=13  overlap=[]
9f7394b7 09-05T15:00 main-commits=1  files=2   overlap=[]
46fb827e 09-05T15:10 main-commits=11 files=7   overlap=[]
```

Verdict: 10 of 11 updates were disjoint from the PR at file level; 1 of 11 (the first,
manual) overlapped on one file. Caveat: file-level, not semantic — the first full build is
still owed; the per-update re-run is what the number argues against.
