"""PySide2.QtWidgets 桩件 (见 tools/stubs/PySide2/__init__.py 说明)"""

from PySide2.QtCore import QObject  # noqa: F401


class QWidget(QObject):
    pass


class QPlainTextEdit(QWidget):
    def keyPressEvent(self, event):
        pass

    def pasteEvent(self):
        pass