"""Doctor share access — curated, read-only document sharing with OTP gating.

A share is a per-document subset of one patient's records granted to an
outside doctor. The doctor proves possession of an out-of-band 6-digit OTP
to obtain a short, absolute-TTL session that can view the listed docs and
translate them, but never modify or download them.

Cookie name, auth dependency, and TTL rules are deliberately separate from
the regular ``sessions`` table so a share token can never be promoted into
a normal account session.
"""
