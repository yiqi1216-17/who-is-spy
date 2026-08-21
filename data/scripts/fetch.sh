#!/usr/bin/env bash
# 一键抓取 sources.yaml 登记的四个来源 → data/raw/(不进 Git)。
# 用法:bash data/scripts/fetch.sh [all|werewolf-among-us|spygame|ctwei-spy|ck-arena]
# 幂等:目标目录已存在且非空则跳过;单来源失败不中断其余来源,末尾汇总。
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # 仓库根(who-is-spy/)
RAW="$ROOT/data/raw"
mkdir -p "$RAW"

# 直连 huggingface.co 在当前网络不通,固定走镜像(见 data/README.md §4)
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"

PASS=() ; FAIL=() ; SKIP=()

have() { command -v "$1" >/dev/null 2>&1; }

hf_cli() { # hf(新)优先,huggingface-cli(旧)兜底
  if have hf; then echo hf; elif have huggingface-cli; then echo huggingface-cli; else echo ""; fi
}

nonempty() { [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null)" ]; }

# 当前网络:git 直连 github.com:443 超时,但 curl 走 codeload 可达(实测 2026-08-19)。
# 故优先 curl tarball(可控超时、无 .git 体积),git clone 仅作兜底。
fetch_repo() { # fetch_repo <owner/repo> <dir> [branch,缺省 HEAD]
  local repo="$1" dir="$2" branch="${3:-HEAD}" tgz
  tgz="$(mktemp -t repo.XXXXXX).tgz"
  if curl -fsSL --retry 2 --max-time 300 \
      "https://codeload.github.com/$repo/tar.gz/$branch" -o "$tgz"; then
    mkdir -p "$dir" && tar -xzf "$tgz" -C "$dir" --strip-components=1 && rm -f "$tgz" && return 0
  fi
  rm -f "$tgz"; rm -rf "$dir"
  local b=()
  [ "$branch" != HEAD ] && b=(--branch "$branch")
  git clone --depth 1 ${b[@]+"${b[@]}"} "https://github.com/$repo" "$dir"
}

fetch_werewolf() {
  # HF 来源不做 nonempty 短路:hf download 自身增量(跳过已有文件),部分下载可续传
  local dst="$RAW/werewolf-among-us"
  local cli; cli="$(hf_cli)"
  if [ -z "$cli" ]; then
    echo "!! werewolf-among-us 需要 hf CLI(pip install -U huggingface_hub)——跳过" >&2
    FAIL+=(werewolf-among-us); return
  fi
  # 只取文本转录与标注(允许清单式 include)。视频/特征等多模态部分是 manifest 的
  # blockedUses(未签 Ego4D License),排除法容易漏(实测 *.zip 挡不住 *.mp4),故改白名单。
  "$cli" download bolinlai/Werewolf-Among-Us --repo-type dataset \
    --include '*.json' '*.txt' '*.csv' '*.md' --exclude 'Ego4D/videos/*' 'Youtube/videos/*' \
    --local-dir "$dst" \
    && PASS+=(werewolf-among-us) || FAIL+=(werewolf-among-us)
}

fetch_spygame() {
  local dst="$RAW/spygame"
  nonempty "$dst" && { SKIP+=(spygame); return; }
  echo ">> spygame(GPL-3.0):仅供阅读方法与词对参考,代码禁止拷贝进本仓库"
  fetch_repo Skytliang/SpyGame "$dst" \
    && PASS+=(spygame) || FAIL+=(spygame)
}

fetch_ctwei() {
  local dst="$RAW/ctwei-spy"
  nonempty "$dst" && { SKIP+=(ctwei-spy); return; }
  cat >&2 <<'EOF'
!! QUARANTINE:ct-wei/Who-is-The-Spy 无 LICENSE(默认保留所有权利)。
!! 仅限本地对照实验与格式参考;不得入库 normalized/、不得再分发、不得进 Git。
EOF
  fetch_repo ct-wei/Who-is-The-Spy "$dst" cot \
    && PASS+=(ctwei-spy) || FAIL+=(ctwei-spy)
}

fetch_ckarena() {
  local dst="$RAW/ck-arena" dsthf="$RAW/ck-arena-hf" ok=1
  if nonempty "$dst"; then SKIP+=(ck-arena); else
    fetch_repo Yeswolo/CK-Arena "$dst" || ok=0
  fi
  # HF 词对交给 hf 自身增量,不做 nonempty 短路
  local cli; cli="$(hf_cli)"
  if [ -n "$cli" ]; then
    "$cli" download Xushuhaha/CK-Arena --repo-type dataset --local-dir "$dsthf" || ok=0
  else
    echo "!! ck-arena 的 HF 词对需要 hf CLI(pip install -U huggingface_hub);GitHub 部分不受影响" >&2
  fi
  [ "$ok" = 1 ] && PASS+=(ck-arena) || FAIL+=(ck-arena)
}

target="${1:-all}"
case "$target" in
  all) fetch_werewolf; fetch_spygame; fetch_ctwei; fetch_ckarena ;;
  werewolf-among-us) fetch_werewolf ;;
  spygame)           fetch_spygame ;;
  ctwei-spy)         fetch_ctwei ;;
  ck-arena)          fetch_ckarena ;;
  *) echo "未知来源:$target(可选 all|werewolf-among-us|spygame|ctwei-spy|ck-arena)" >&2; exit 2 ;;
esac

echo
echo "== 汇总 =="
[ ${#PASS[@]} -gt 0 ] && echo "  成功: ${PASS[*]}"
[ ${#SKIP[@]} -gt 0 ] && echo "  已存在跳过: ${SKIP[*]}"
[ ${#FAIL[@]} -gt 0 ] && { echo "  失败: ${FAIL[*]}(GitHub raw/HF 偶发抖动,可重跑本脚本)"; exit 1; }
exit 0
