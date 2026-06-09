"""Python mirror of the @viewer/core generators module.

A generator EMITS Views (params -> list[View dict]); `run_generator` validates
every emitted View. The knowledge-graph generator is the cross-platform proof
case and must stay byte-identical to the TS mirror for the same input; the rest
form the demo slate (one generator per View family).

`register_all_generators()` is the single populate-the-registry seam — one call
instead of N — mirroring the TS `registerAllGenerators()`. Idempotent.
"""

from .viewer_generators import (  # noqa: F401
    knowledge_graph_build,
    knowledge_graph_generator,
    list_generators,
    get_generator,
    register_generator,
    run_generator,
)

# Demo slate generator dicts + their pure builds.
from .sprint_board import sprint_board_build, sprint_board_generator  # noqa: F401
from .data_table import data_table_build, data_table_generator  # noqa: F401
from .flow_diagram import flow_diagram_build, flow_diagram_generator  # noqa: F401
from .status_report import status_report_build, status_report_generator  # noqa: F401
from .math_sheet import math_sheet_build, math_sheet_generator  # noqa: F401
from .metric_tiles import metric_tiles_build, metric_tiles_generator  # noqa: F401
from .timeline import timeline_build, timeline_generator  # noqa: F401
from .image_gallery import image_gallery_build, image_gallery_generator  # noqa: F401
from .json_inspector import json_inspector_build, json_inspector_generator  # noqa: F401
from .workspace import workspace_build, workspace_generator  # noqa: F401

# Every generator in the slate, in slate order (knowledge-graph first).
ALL_GENERATORS: list[dict] = [
    knowledge_graph_generator,
    sprint_board_generator,
    data_table_generator,
    flow_diagram_generator,
    status_report_generator,
    math_sheet_generator,
    metric_tiles_generator,
    timeline_generator,
    image_gallery_generator,
    json_inspector_generator,
    workspace_generator,
]


def register_all_generators() -> None:
    """Register every slate generator with the shared registry. Idempotent."""
    for entry in ALL_GENERATORS:
        register_generator(entry)
