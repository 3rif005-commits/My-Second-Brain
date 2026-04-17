"""Web article extraction using trafilatura."""

import trafilatura


def extract_url(url: str) -> tuple[str, str]:
    """
    Fetch and extract the main content of a web page.
    Returns (title, body_text).
    Raises ValueError if extraction fails.
    """
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ValueError(f"Could not fetch URL: {url}")

    result = trafilatura.extract(
        downloaded,
        include_comments=False,
        include_tables=True,
        no_fallback=False,
        output_format="txt",
    )
    if not result:
        raise ValueError("Could not extract readable content from the page.")

    metadata = trafilatura.extract_metadata(downloaded)
    title = (metadata.title if metadata and metadata.title else "") or url

    return title, result
