#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Host firewall (08 §4): SSH only from the admin address(es); 80/443 only from Cloudflare.
#
# Docker publishes ports through its own iptables chains and BYPASSES ufw, so the web ports are
# filtered in the DOCKER-USER chain (Docker's documented hook), and ufw handles the host itself.
# Idempotent; re-run by cloudflare-ips.sh whenever Cloudflare's list changes.
#
#   sudo scripts/ops/firewall.sh            (reads /etc/wiskiflix/admin-ips.txt and
#                                            /etc/wiskiflix/cloudflare-ips-v4.txt, -v6.txt)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ETC=/etc/wiskiflix
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -s "$ETC/admin-ips.txt" ] || { echo "put your own IP (or a /32 range) in $ETC/admin-ips.txt first"; exit 1; }
[ -s "$ETC/cloudflare-ips-v4.txt" ] || { echo "run scripts/ops/cloudflare-ips.sh first"; exit 1; }

# ── host: ufw ──
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
while read -r ip; do
  [ -n "$ip" ] && ufw allow from "$ip" to any port 22 proto tcp comment 'ssh admin'
done < <(grep -v '^#' "$ETC/admin-ips.txt")
ufw --force enable

# ── containers: DOCKER-USER (applies to the published nginx ports) ──
apply() { # <iptables|ip6tables> <ranges file>
  local ipt="$1" file="$2"
  "$ipt" -N WF-WEB 2>/dev/null || "$ipt" -F WF-WEB
  while read -r net; do
    [ -n "$net" ] && "$ipt" -A WF-WEB -s "$net" -j RETURN
  done < <(grep -v '^#' "$file")
  "$ipt" -A WF-WEB -j DROP
  "$ipt" -N DOCKER-USER 2>/dev/null || true
  while "$ipt" -D DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j WF-WEB 2>/dev/null; do :; done
  while "$ipt" -D DOCKER-USER -p tcp -m conntrack --ctorigdstport 80 --ctdir ORIGINAL -j WF-WEB 2>/dev/null; do :; done
  "$ipt" -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 80 --ctdir ORIGINAL -j WF-WEB
  "$ipt" -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j WF-WEB
}
apply iptables "$ETC/cloudflare-ips-v4.txt"
[ -s "$ETC/cloudflare-ips-v6.txt" ] && apply ip6tables "$ETC/cloudflare-ips-v6.txt"
echo "firewall: ssh from $(grep -vc '^#' "$ETC/admin-ips.txt") address(es); web from Cloudflare only"
