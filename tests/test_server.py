import socket
import unittest
from unittest.mock import patch, MagicMock
import server

class PortDetectionTests(unittest.TestCase):
    def test_virtual_adapter_connection_does_not_count_as_local_listener(self):
        def connect(address, timeout):
            if address[0] == '127.0.0.1':
                raise ConnectionRefusedError()
            return MagicMock()
        with patch.object(socket, 'create_connection', side_effect=connect):
            self.assertFalse(server.port_is_listening(8766, ['100.64.164.2']))

    def test_real_loopback_listener_is_still_protected(self):
        with patch.object(socket, 'create_connection', return_value=MagicMock()):
            self.assertTrue(server.port_is_listening(8766, []))

class DestroyerServingTests(unittest.TestCase):
    def test_ship_runtime_modules_are_served(self):
        for name in ('destroyer.js', 'ship-camera.js', 'naval-models.js', 'ambient-fleet.js', 'campaign.js', 'maps.js', 'quality.js', 'map-scenery.js', 'fa18.js', 'fa18-armament.js'):
            with self.subTest(name=name):
                self.assertIsNotNone(server.game_path('/' + name))

    def test_required_aircraft_metadata_is_served_without_exposing_other_json(self):
        self.assertIsNotNone(server.game_path('/assets/models/fa18c.metadata.json'))
        self.assertIsNone(server.game_path('/assets/models/j16.metadata.json'))

    def test_source_and_verification_stay_private(self):
        for name in ('README.md', 'tests/browser-destroyer.mjs', 'verification/destroyer/metrics.json', '.openai/hosting.json'):
            with self.subTest(name=name):
                self.assertIsNone(server.game_path('/' + name))

if __name__ == '__main__':
    unittest.main()
