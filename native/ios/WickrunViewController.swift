import Capacitor

/// Set Main.storyboard's initial controller to this class in the App module.
@objc(WickrunViewController)
public final class WickrunViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SncHttpPlugin())
        bridge?.registerPluginInstance(WickrunSecretsPlugin())
    }
}
