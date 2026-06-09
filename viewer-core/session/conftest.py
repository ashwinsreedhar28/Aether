"""Make viewer_core (../python) and the Lattice node SDK (../../Lattice)
importable for the test suite, the same way viewer_session.py wires them at
runtime. Lets `pytest` discover the tests from this directory directly."""

import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "python"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "Lattice"))
