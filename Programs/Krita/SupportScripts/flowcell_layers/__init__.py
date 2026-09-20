from krita import Krita
from .plugin import FlowCellLayers

Krita.instance().addExtension(FlowCellLayers(Krita.instance()))
