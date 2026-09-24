"""Source tables reach the note verbatim (E6c follow-up)."""
from services.workspace.tables import carry_tables, label_tables

SRC = [{"title": "L10", "text": "[page 3]\nIntro\n|Term|Meaning|\n|---|---|\n|Q|value|\n|R|reward|\n\nmore"},
       {"title": "L11", "text": "|Bias|Source|\n|:--|--:|\n|proxy|data|"}]


def test_every_table_is_labelled_and_kept_in_the_source():
    labelled, tables = label_tables(SRC)
    assert list(tables) == ["[[TABLE 1.1]]", "[[TABLE 2.1]]"]
    assert "[[TABLE 1.1]]\n|Term|Meaning|" in labelled[0]["text"]
    assert tables["[[TABLE 1.1]]"] == "|Term|Meaning|\n|---|---|\n|Q|value|\n|R|reward|"


def test_a_placed_marker_becomes_the_exact_table():
    _, tables = label_tables(SRC)
    md = "# Guide\n\n## RL\n\n[[TABLE 1.1]]\n\nText.\n\n  [[TABLE 2.1]]  \n"
    out = carry_tables(md, tables)
    assert "|Q|value|\n|R|reward|" in out and "|proxy|data|" in out
    assert "[[TABLE" not in out and "Tables from the slides" not in out


def test_an_unplaced_table_is_appended_never_lost():
    _, tables = label_tables(SRC)
    out = carry_tables("# Guide\n\n[[TABLE 2.1]]\n", tables)
    assert out.index("|proxy|data|") < out.index("## Tables from the slides")
    assert out.endswith("|Q|value|\n|R|reward|\n")


def test_an_invented_marker_is_dropped_and_an_unoffered_table_not_appended():
    _, tables = label_tables(SRC)
    out = carry_tables("# G\n[[TABLE 9.9]]\n", tables, offered="... [[TABLE 1.1]] ...")
    assert "[[TABLE 9.9]]" not in out
    assert "|Q|value|" in out and "|proxy|data|" not in out


def test_tables_written_back_to_back_are_two_tables():
    """Real slide extraction: 23 tables came out as 16 matches because two
    tables with no blank line between them read as one."""
    src = [{"text": "|A|B|\n|---|---|\n|1|2|\n|C|D|\n|---|---|\n|3|4|"}]
    labelled, tables = label_tables(src)
    assert list(tables.values()) == ["|A|B|\n|---|---|\n|1|2|", "|C|D|\n|---|---|\n|3|4|"]
    assert "[[TABLE 1.2]]\n|C|D|" in labelled[0]["text"]


def test_the_html_path_places_tables_where_the_markers_are():
    from services.workspace.tables import carry_tables_html
    _, tables = label_tables(SRC)
    html = "<h1>G</h1><h2>RL</h2><p>[[TABLE 1.1]]</p><p>text</p>"
    out = carry_tables_html(html, tables)
    assert out.startswith("<h1>G</h1><h2>RL</h2><table>")
    assert "<td>reward</td>" in out and "[[TABLE" not in out
    assert out.index("Tables from the slides") < out.index("<td>proxy</td>")   # 2.1 appended


def test_a_table_the_model_retyped_is_not_appended_again():
    from services.workspace.tables import carry_tables_html
    _, tables = label_tables(SRC)
    retyped = ("<h1>G</h1><p>[[TABLE 1.1]]</p><table><tr><th>Bias</th><th>Source</th></tr>"
               "<tr><td>Proxy</td><td>data</td></tr></table>")
    out = carry_tables_html(retyped, tables)
    assert "Tables from the slides" not in out          # 2.1 is already there
    md = "# G\n\n|Bias|Source|\n|---|---|\n|proxy|data|\n"
    assert "Tables from the slides" not in carry_tables(md, tables, offered="[[TABLE 2.1]]")


def test_an_unplaced_table_goes_to_the_section_about_its_page():
    from services.workspace.tables import carry_tables_html
    src = [{"text": "[page 2]\nintro\n[page 5]\n|Q|Left|\n|---|---|\n|s1|0.5|"}]
    _, tables = label_tables(src)
    html = ('<h1>G</h1><h2>RL</h2><h3 data-anchor="1:p:2">Intro</h3><p>a</p>'
            '<h3 data-anchor="1:p:4">Q-values</h3><p>b</p>'
            '<h3 data-anchor="1:p:9">Later</h3><p>c</p>')
    out = carry_tables_html(html, tables)
    assert "Tables from the slides" not in out
    # after the p.4 section's text, before the p.9 section
    assert out.index("<p>b</p>") < out.index("<table>") < out.index('data-anchor="1:p:9"')


def test_a_table_with_no_matching_section_still_reaches_the_appendix():
    from services.workspace.tables import carry_tables_html
    src = [{"text": "[page 1]\n|A|B|\n|---|---|\n|1|2|"}]
    _, tables = label_tables(src)
    out = carry_tables_html('<h1>G</h1><h3 data-anchor="1:p:7">Late</h3>', tables)
    assert "Tables from the slides" in out


def test_two_runs_never_share_page_numbers():
    a = label_tables([{"text": "[page 3]\n|A|B|\n|---|---|\n|1|2|"}])[1]
    b = label_tables([{"text": "[page 8]\n|C|D|\n|---|---|\n|3|4|"}])[1]
    assert a.pages["[[TABLE 1.1]]"] == (1, 3) and b.pages["[[TABLE 1.1]]"] == (1, 8)


def test_the_markdown_path_places_by_page_too():
    src = [{"text": "[page 5]\n|Q|Left|\n|---|---|\n|s1|0.5|"}]
    _, tables = label_tables(src)
    md = "# G\n\n### Q-values {1:p:4}\nText b.\n\n### Later {1:p:9}\nText c.\n"
    out = carry_tables(md, tables)
    assert "Tables from the slides" not in out
    assert out.index("Text b.") < out.index("|Q|Left|") < out.index("### Later")
    from services.workspace.md_to_blocks import markdown_to_html
    assert markdown_to_html(out).count("<table>") == 1
