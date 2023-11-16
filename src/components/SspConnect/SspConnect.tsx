import { useEffect, useState } from 'react';
import { useSspConnect } from '../../hooks/useSspConnect';
import SignMessage from '../../components/SignMessage/SignMessage';

interface signMessageData {
  data: string;
}

function SspConnect() {
  const {
    address: sspConnectAddress,
    message: sspConnectMessage,
    chain: sspConnectChain,
    clearRequest,
  } = useSspConnect();
  const [openSignMessage, setOpenSignMessage] = useState(false);
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [chain, setChain] = useState('');

  useEffect(() => {
    console.log(sspConnectMessage);
    if (sspConnectMessage) {
      setAddress(sspConnectAddress);
      setMessage(sspConnectMessage);
      setChain(sspConnectChain);
      setOpenSignMessage(true);
      clearRequest?.();
    }
  }, [sspConnectMessage]);

  const signMessageAction = (data: signMessageData | null) => {
    if (chrome?.runtime?.sendMessage) {
      // we do not use sendResponse, instead we are sending new message
      if (!data) {
        setOpenSignMessage(false);
        // reject message
        void chrome.runtime.sendMessage({
          origin: 'ssp',
          data: 'REQUEST REJECTED',
        });
      } else {
        void chrome.runtime.sendMessage({
          origin: 'ssp',
          data,
        });
      }
    } else {
      console.log('no chrome.runtime.sendMessage');  }
  };
  return (
    <>
      <SignMessage
        open={openSignMessage}
        openAction={signMessageAction}
        address={address}
        message={message}
        chain={chain}
      />
    </>
  );
}

export default SspConnect;
