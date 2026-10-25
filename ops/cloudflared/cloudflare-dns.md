# DNS records for VoidFlippr on Cloudflare
#
# In Cloudflare dashboard -> voidflippr.example.com -> DNS -> Records:
#
# If using Cloudflare Tunnel (recommended - no open ports on the VPS):
#   Run after `cloudflared tunnel create voidflippr`:
#     cloudflared tunnel route dns voidflippr voidflippr.example.com
#     cloudflared tunnel route dns voidflippr www
#   Cloudflare creates the CNAMEs automatically.
#
# If NOT using a tunnel (nginx exposed directly), add manually:
# Type | Name | Content        | Proxy status | TTL  | Notes
# -----+------+----------------+--------------+------+------------------------
# A    | @    | <VPS_IPV4>     | Proxied      | Auto | Apex, orange cloud
# AAAA | @    | <VPS_IPV6>     | Proxied      | Auto | Apex, orange cloud (optional)
# A    | www  | <VPS_IPV4>     | Proxied      | Auto | Or CNAME -> @
#
# Recommended Cloudflare settings (dashboard -> SSL/TLS):
#   Overview:           Full (strict) - required if you bypass the tunnel
#   Edge Certificates:  Always Use HTTPS = ON, Min TLS = 1.2
#   Origin Server:      Only needed if not using a tunnel (Origin Certificate)
#
# Recommended Cloudflare settings (dashboard -> Caching -> Configuration):
#   Caching Level:      Standard
#   Browser Cache TTL:  Respect Existing Headers
#   Note: don't cache /daily-* - those must hit origin every time.
#         The default Standard caching respects Cache-Control: no-store
#         which is already set on every API response from the Node server.
#
# Recommended Cloudflare settings (dashboard -> Security):
#   Security Level:     Medium
#   Bot Fight Mode:     ON