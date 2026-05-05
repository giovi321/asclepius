"""Unit tests for the OIDC role-sync helpers.

We don't exercise the full callback here — that would need a real provider.
Instead we cover the pure mapping layer that decides which local role an
OIDC userinfo payload resolves to.
"""

from asclepius.auth.oidc import (
    _map_oidc_role,
    _normalise_roles,
    _read_claim_path,
)
from asclepius.config.models import OidcConfig


def _cfg(**overrides) -> OidcConfig:
    base = OidcConfig(enabled=True, sync_roles=True)
    for k, v in overrides.items():
        setattr(base, k, v)
    return base


def test_read_claim_path_top_level():
    assert _read_claim_path({"groups": ["a", "b"]}, "groups") == ["a", "b"]


def test_read_claim_path_nested_keycloak_shape():
    claims = {"realm_access": {"roles": ["admin", "user"]}}
    assert _read_claim_path(claims, "realm_access.roles") == ["admin", "user"]


def test_read_claim_path_missing_segment_returns_none():
    assert _read_claim_path({"a": {"b": 1}}, "a.missing") is None
    assert _read_claim_path({"a": "string"}, "a.b") is None


def test_normalise_roles_list():
    assert _normalise_roles(["admin", "editor"]) == ["admin", "editor"]


def test_normalise_roles_space_separated_string():
    assert _normalise_roles("admin editor") == ["admin", "editor"]


def test_normalise_roles_noise_is_dropped():
    assert _normalise_roles(None) == []
    assert _normalise_roles(42) == []
    assert _normalise_roles([None, "", " "]) == []


def test_map_role_returns_none_when_sync_disabled():
    cfg = OidcConfig(enabled=True, sync_roles=False, admin_roles=["admins"])
    assert _map_oidc_role({"groups": ["admins"]}, cfg) is None


def test_map_role_admin_wins_over_editor():
    cfg = _cfg(admin_roles=["admins"], editor_roles=["editors"])
    claims = {"groups": ["editors", "admins"]}
    assert _map_oidc_role(claims, cfg) == "admin"


def test_map_role_editor_when_no_admin_match():
    cfg = _cfg(admin_roles=["admins"], editor_roles=["editors"])
    claims = {"groups": ["editors"]}
    assert _map_oidc_role(claims, cfg) == "editor"


def test_map_role_viewer_match():
    cfg = _cfg(viewer_roles=["viewers"])
    claims = {"groups": ["viewers"]}
    assert _map_oidc_role(claims, cfg) == "viewer"


def test_map_role_falls_back_to_default_when_nothing_matches():
    cfg = _cfg(admin_roles=["admins"], default_role="viewer")
    claims = {"groups": ["random-group"]}
    assert _map_oidc_role(claims, cfg) == "viewer"


def test_map_role_falls_back_even_when_claim_missing():
    cfg = _cfg(admin_roles=["admins"], default_role="viewer")
    assert _map_oidc_role({}, cfg) == "viewer"


def test_map_role_honours_nested_claim_path():
    cfg = _cfg(
        roles_claim="realm_access.roles",
        admin_roles=["realm-admin"],
    )
    claims = {"realm_access": {"roles": ["realm-admin"]}}
    assert _map_oidc_role(claims, cfg) == "admin"
