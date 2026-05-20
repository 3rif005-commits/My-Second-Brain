"""Shared test fixtures."""
import pytest


@pytest.fixture
def tmp_skills_dir(tmp_path):
    """A temp directory with no skills, ready to be populated."""
    d = tmp_path / "skills"
    d.mkdir()
    return d
