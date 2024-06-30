import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Form,
  message,
  Divider,
  Button,
  Input,
  Space,
  Popconfirm,
  Popover,
  Select,
  Collapse,
} from 'antd';
import localForage from 'localforage';
import { NoticeType } from 'antd/es/message/interface';
import Navbar from '../../components/Navbar/Navbar';
import { constructAndSignEVMTransaction } from '../../lib/constructTx';
import { useAppSelector, useAppDispatch } from '../../hooks';
import { getFingerprint } from '../../lib/fingerprint';
import { decrypt as passworderDecrypt } from '@metamask/browser-passworder';
import secureLocalStorage from 'react-secure-storage';
import {
  generateAddressKeypair,
  getScriptType,
  deriveEVMPublicKey,
} from '../../lib/wallet';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import ConfirmTxKey from '../../components/ConfirmTxKey/ConfirmTxKey';
import TxSent from '../../components/TxSent/TxSent';
import TxRejected from '../../components/TxRejected/TxRejected';
import { fetchAddressTransactions } from '../../lib/transactions.ts';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { sspConfig } from '@storage/ssp';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../../hooks/useSocket';
import { blockchains } from '@storage/blockchains';
import { setContacts } from '../../store';

import { transaction, utxo } from '../../types';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux.tsx';
import SspConnect from '../../components/SspConnect/SspConnect.tsx';
import './SendEVM.css';

interface contactOption {
  label: string;
  index?: string;
  value: string;
}

interface contactsInterface {
  label: string;
  options: contactOption[];
}

interface publicNonces {
  kPublic: string;
  kTwoPublic: string;
}

interface sendForm {
  receiver: string;
  amount: string;
  fee: string;
  message: string;
  utxos: utxo[]; // RBF mandatory utxos - use all of them or one?
  paymentAction?: boolean;
}

let txSentInterval: string | number | NodeJS.Timeout | undefined;
let alreadyRunning = false;

function SendEVM() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const state = location.state as sendForm;
  const {
    txid: socketTxid,
    clearTxid,
    txRejected,
    chain: txChain,
    clearTxRejected,
  } = useSocket();
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const { t } = useTranslation(['send', 'common', 'home']);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const { activeChain, sspWalletKeyInternalIdentity } = useAppSelector(
    (state) => state.sspState,
  );
  const { xpubKey, wallets, walletInUse } = useAppSelector(
    (state) => state[activeChain],
  );
  const transactions = wallets[walletInUse].transactions;
  const sender = wallets[walletInUse].address;
  const [spendableBalance, setSpendableBalance] = useState('0');
  const [openConfirmTx, setOpenConfirmTx] = useState(false);
  const [openTxSent, setOpenTxSent] = useState(false);
  const [openTxRejected, setOpenTxRejected] = useState(false);
  const [txHex, setTxHex] = useState('');
  const [txid, setTxid] = useState('');
  const [sendingAmount, setSendingAmount] = useState('0');
  const [txReceiver, setTxReceiver] = useState('');
  const [txFee, setTxFee] = useState('0');
  const [baseGasPrice, setBaseGasPrice] = useState('2');
  const [priorityGasPrice, setPriorityGasPrice] = useState('2');
  const [totalGasLimit, setTotalGasLimit] = useState('200000');
  const [validateStatusAmount, setValidateStatusAmount] = useState<
    '' | 'success' | 'error' | 'warning' | 'validating' | undefined
  >('success');
  const [useMaximum, setUseMaximum] = useState(false);
  const [manualFee, setManualFee] = useState(false);
  const [contactsItems, setContactsItems] = useState<contactsInterface[]>([]);
  const { networkFees } = useAppSelector((state) => state.networkFees);
  const { contacts } = useAppSelector((state) => state.contacts);

  const blockchainConfig = blockchains[activeChain];
  const { passwordBlob } = useAppSelector((state) => state.passwordBlob);

  useEffect(() => {
    try {
      if (state.amount) {
        setSendingAmount(state.amount);
        form.setFieldValue('amount', state.amount);
      }
      if (state.receiver) {
        setTxReceiver(state.receiver);
        form.setFieldValue('receiver', state.receiver);
      }
    } catch (error) {
      console.log(error);
    }
  }, [state.receiver, state.amount]);

  useEffect(() => {
    if (alreadyMounted.current) return;
    alreadyMounted.current = true;
    try {
      console.log(networkFees);
    } catch (error) {
      console.log(error);
    }
  });

  useEffect(() => {
    const wItems: contactOption[] = [];
    Object.keys(wallets).forEach((wallet) => {
      const typeNumber = Number(wallet.split('-')[0]);
      const walletNumber = Number(wallet.split('-')[1]) + 1;
      let walletName = 'Wallet ' + walletNumber;
      if (typeNumber === 1) {
        walletName = 'Change ' + walletNumber;
      }
      const wal = {
        value: wallets[wallet].address,
        index: wallet,
        label: t('home:navbar.chain_wallet', {
          chain: blockchainConfig.name,
          wallet: walletName,
        }),
      };
      wItems.push(wal);
    });
    wItems.sort((a, b) => {
      if (!a.index || !b.index) return 0;
      if (+a.index.split('-')[1] < +b.index.split('-')[1]) return -1;
      if (+a.index.split('-')[1] > +b.index.split('-')[1]) return 1;
      return 0;
    });
    wItems.sort((a, b) => {
      if (!a.index || !b.index) return 0;
      if (+a.index.split('-')[0] < +b.index.split('-')[0]) return -1;
      if (+a.index.split('-')[0] > +b.index.split('-')[0]) return 1;
      return 0;
    });
    const sendContacts = [];
    const contactsOptions: contactOption[] = [];
    contacts[activeChain]?.forEach((contact) => {
      const option = {
        label:
          contact.name ||
          new Date(contact.id).toLocaleDateString() +
            ' ' +
            new Date(contact.id).toLocaleTimeString(),
        value: contact.address,
      };
      contactsOptions.push(option);
    });
    if (contactsOptions.length > 0) {
      sendContacts.push({
        label: 'Contacts',
        options: contactsOptions,
      });
    }
    sendContacts.push({
      label: 'My Wallets',
      options: wItems,
    });
    setContactsItems(sendContacts);
  }, [wallets, activeChain]);

  // on every chain, address adjustment, fetch utxos
  // used to get a precise estimate of the tx size
  useEffect(() => {
    if (alreadyRunning) return;
    alreadyRunning = true;
    getSpendableBalance();
    calculateTxFeeSize();
    alreadyRunning = false;
  }, [walletInUse, activeChain, sendingAmount, manualFee]);

  useEffect(() => {
    if (useMaximum && !manualFee) {
      return;
    }
    getSpendableBalance();
    calculateTxFeeSize();
  }, [baseGasPrice, priorityGasPrice, totalGasLimit]);

  useEffect(() => {
    const totalAmount = new BigNumber(sendingAmount).plus(baseGasPrice || '0');
    const maxSpendable = new BigNumber(spendableBalance).dividedBy(
      10 ** blockchainConfig.decimals,
    );
    if (totalAmount.isGreaterThan(maxSpendable)) {
      // mark amount in red box as bad inpout
      setValidateStatusAmount('error');
    } else {
      setValidateStatusAmount('success');
    }
  }, [walletInUse, activeChain, sendingAmount, baseGasPrice]);

  useEffect(() => {
    if (useMaximum) {
      const maxSpendable = new BigNumber(spendableBalance).dividedBy(
        10 ** blockchainConfig.decimals,
      );
      const fee = new BigNumber(baseGasPrice || '0');
      setSendingAmount(
        maxSpendable.minus(fee).isGreaterThan(0)
          ? maxSpendable.minus(fee).toFixed()
          : '0',
      );
      form.setFieldValue(
        'amount',
        maxSpendable.minus(fee).isGreaterThan(0)
          ? maxSpendable.minus(fee).toFixed()
          : '0',
      );
    }
  }, [useMaximum, spendableBalance]);

  useEffect(() => {
    if (txid) {
      setOpenConfirmTx(false);
      setTimeout(() => {
        if (state.paymentAction) {
          payRequestAction({
            status: t('common:success'),
            data: t('home:payment_request.transaction_sent'),
            txid,
          });
        }
        setOpenTxSent(true);
      });
    }
  }, [txid]);

  useEffect(() => {
    if (socketTxid) {
      setTxid(socketTxid);
      clearTxid?.();
      // stop interval
      if (txSentInterval) {
        clearInterval(txSentInterval);
      }
    }
  }, [socketTxid]);

  useEffect(() => {
    if (txRejected) {
      setOpenConfirmTx(false);
      setTimeout(() => {
        if (state.paymentAction) {
          payRequestAction(null);
        }
        setOpenTxRejected(true);
      });
      if (txSentInterval) {
        clearInterval(txSentInterval);
      }
      clearTxRejected?.();
    }
  }, [txRejected]);

  const displayMessage = (type: NoticeType, content: string) => {
    void messageApi.open({
      type,
      content,
    });
  };

  const confirmTxAction = (status: boolean) => {
    setOpenConfirmTx(status);
    if (status === false) {
      // stop refreshing
      if (txSentInterval) {
        clearInterval(txSentInterval);
      }
    }
  };
  const txSentAction = (status: boolean) => {
    setOpenTxSent(status);
    if (status === false) {
      // all ok, navigate back to home
      navigate('/home');
    }
  };

  const txRejectedAction = (status: boolean) => {
    setOpenTxRejected(status);
  };

  const getSpendableBalance = () => {
    // get spendable balance
    // fetch our address new balance
    setSpendableBalance('1000000000000000000000000');
  };

  const calculateTxFeeSize = () => {
    console.log('CALC tx fee');
  };

  const postAction = (
    action: string,
    payload: string,
    chain: string,
    path: string,
    wkIdentity: string,
  ) => {
    const data = {
      action,
      payload,
      chain,
      path,
      wkIdentity,
    };
    axios
      .post(`https://${sspConfig().relay}/v1/action`, data)
      .then((res) => {
        console.log(res);
      })
      .catch((error) => {
        console.log(error);
      });
  };

  const onFinish = (values: sendForm) => {
    console.log(values);
    if (values.receiver.length < 8 || !values.receiver.startsWith('0x')) {
      displayMessage('error', t('send:err_invalid_receiver'));
      return;
    }
    if (!values.amount || +values.amount <= 0 || isNaN(+values.amount)) {
      displayMessage('error', t('send:err_invalid_amount'));
      return;
    }
    if (!values.fee || +values.fee < 0 || isNaN(+values.fee)) {
      displayMessage('error', t('send:err_invalid_fee'));
      return;
    }
    // get our password to decrypt xpriv from secure storage
    const fingerprint: string = getFingerprint();
    passworderDecrypt(fingerprint, passwordBlob)
      .then(async (password) => {
        if (typeof password !== 'string') {
          throw new Error(t('send:err_pwd_not_valid'));
        }
        const xprivBlob = secureLocalStorage.getItem(
          `xpriv-48-${blockchainConfig.slip}-0-${getScriptType(
            blockchainConfig.scriptType,
          )}-${blockchainConfig.id}`,
        );
        if (typeof xprivBlob !== 'string') {
          throw new Error(t('send:err_invalid_xpriv'));
        }
        const xprivChain = await passworderDecrypt(password, xprivBlob);
        if (typeof xprivChain !== 'string') {
          throw new Error(t('send:err_invalid_xpriv_decrypt'));
        }
        const wInUse = walletInUse;
        const splittedDerPath = wInUse.split('-');
        const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
        const addressIndex = Number(splittedDerPath[1]);
        const keyPair = generateAddressKeypair(
          xprivChain,
          typeIndex,
          addressIndex,
          activeChain,
        );
        const publicKey2HEX = deriveEVMPublicKey(
          xpubKey,
          typeIndex,
          addressIndex,
          activeChain,
        ); // ssp key
        const sspKeyPublicNonces: publicNonces[] =
          (await localForage.getItem('sspKeyPublicNonces')) ?? []; // an array of [{kPublic, kTwoPublic}...]
        if (!sspKeyPublicNonces.length) {
          throw new Error(t('send:err_public_nonces'));
        }
        // choose random nonce
        const pos = Math.floor(Math.random() * (sspKeyPublicNonces.length + 1));
        const publicNoncesSSP = sspKeyPublicNonces[pos];
        // delete the nonce from the array
        sspKeyPublicNonces.splice(pos, 1);
        // save the array back to storage
        await localForage.setItem('sspKeyPublicNonces', sspKeyPublicNonces);
        const amount = new BigNumber(values.amount).toFixed();
        constructAndSignEVMTransaction(
          activeChain,
          values.receiver,
          amount,
          keyPair.privKey as `0x${string}`,
          publicKey2HEX,
          publicNoncesSSP,
        )
          .then((signedTx) => {
            console.log(signedTx);
            // post to ssp relay
            postAction(
              'tx',
              signedTx,
              activeChain,
              wInUse,
              sspWalletKeyInternalIdentity,
            );
            setTxHex(signedTx);
            setOpenConfirmTx(true);
            if (txSentInterval) {
              clearInterval(txSentInterval);
            }
            txSentInterval = setInterval(() => {
              fetchTransactions();
            }, 5000);
            // construction was successful, save receier to contacts
            const contactExists = contacts[activeChain]?.find(
              (contact) => contact.address === values.receiver,
            );
            const myAddresses: string[] = [];
            Object.keys(wallets).forEach((wallet) => {
              myAddresses.push(wallets[wallet].address);
            });

            if (!contactExists && !myAddresses.includes(values.receiver)) {
              const newContact = {
                id: new Date().getTime(),
                name: '', // save as empty string which will force date to be shown
                address: values.receiver,
              };
              const adjContacts = [];
              contacts[activeChain]?.forEach((contact) => {
                adjContacts.push(contact);
              });
              adjContacts.push(newContact);
              const completeContacts = {
                ...contacts,
                [activeChain]: adjContacts,
              };
              dispatch(setContacts(completeContacts));
              void (async function () {
                try {
                  await localForage.setItem('contacts', completeContacts);
                } catch (error) {
                  console.log(error);
                }
              })();
            }
          })
          .catch((error: TypeError) => {
            displayMessage('error', error.message);
            console.log(error);
          });
      })
      .catch((error) => {
        console.log(error);
        displayMessage('error', t('send:err_s1'));
      });

    const fetchTransactions = () => {
      fetchAddressTransactions(sender, activeChain, 0, 3)
        .then((txs) => {
          const amount = new BigNumber(0)
            .minus(
              new BigNumber(values.amount).multipliedBy(
                10 ** blockchainConfig.decimals,
              ),
            )
            .toFixed();
          // amount must be the same and not present in our transactions table
          txs.forEach((tx) => {
            if (tx.amount === amount) {
              const txExists = transactions.find(
                (ttx: transaction) => ttx.txid === tx.txid,
              );
              if (!txExists) {
                setTxid(tx.txid);
                // stop interval
                if (txSentInterval) {
                  clearInterval(txSentInterval);
                }
              }
            }
          });
        })
        .catch((error) => {
          console.log(error);
        });
    };
  };

  interface paymentData {
    status: string;
    txid?: string;
    data?: string;
  }

  const payRequestAction = (data: paymentData | null) => {
    console.log(data);
    if (chrome?.runtime?.sendMessage) {
      // we do not use sendResponse, instead we are sending new message
      if (!data) {
        // reject message
        void chrome.runtime.sendMessage({
          origin: 'ssp',
          data: {
            status: t('common:error'),
            result: t('common:request_rejected'),
          },
        });
      } else {
        void chrome.runtime.sendMessage({
          origin: 'ssp',
          data,
        });
      }
    } else {
      console.log('no chrome.runtime.sendMessage');
    }
  };

  const cancelSend = () => {
    if (state.paymentAction) {
      payRequestAction(null);
    }
    navigate('/home');
  };

  const content = (
    <div>
      <p>{t('home:transactionsTable.replace_by_fee_desc')}</p>
      <p>{t('home:transactionsTable.replace_by_fee_desc_b')}</p>
      <p>{t('send:replace_by_fee_stop')}</p>
    </div>
  );

  const refresh = () => {
    console.log(
      'just a placeholder, navbar has refresh disabled but refresh is required to be passed',
    );
  };

  return (
    <>
      {contextHolder}
      <Navbar refresh={refresh} hasRefresh={false} />
      <Divider />
      <Form
        name="sendForm"
        form={form}
        onFinish={(values) => void onFinish(values as sendForm)}
        autoComplete="off"
        layout="vertical"
        itemRef="txFeeRef"
        style={{ paddingBottom: '43px' }}
      >
        <Form.Item label={t('send:receiver_address')}>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item
              name="receiver"
              noStyle
              rules={[
                {
                  required: true,
                  message: t('send:input_receiver_address'),
                },
              ]}
            >
              <Input
                size="large"
                value={txReceiver}
                placeholder={t('send:receiver_address')}
                onChange={(e) => {
                  setTxReceiver(e.target.value),
                    form.setFieldValue('receiver', e.target.value);
                }}
              />
            </Form.Item>
            <Select
              size="large"
              className="no-text-select"
              style={{ width: '40px' }}
              defaultValue=""
              value={txReceiver}
              popupMatchSelectWidth={false}
              onChange={(value) => {
                setTxReceiver(value), form.setFieldValue('receiver', value);
              }}
              options={contactsItems}
              dropdownRender={(menu) => <>{menu}</>}
            />
          </Space.Compact>
        </Form.Item>

        <Form.Item
          label={t('send:amount_to_send')}
          name="amount"
          rules={[{ required: true, message: t('send:input_amount') }]}
          validateStatus={validateStatusAmount}
        >
          <Input
            size="large"
            value={sendingAmount}
            onChange={(e) => {
              setSendingAmount(e.target.value);
              setUseMaximum(false);
            }}
            placeholder={t('send:input_amount')}
            suffix={blockchainConfig.symbol}
          />
        </Form.Item>
        <Button
          type="text"
          size="small"
          style={{
            marginTop: '-22px',
            float: 'right',
            marginRight: 3,
            fontSize: 12,
            color: '#4096ff',
            cursor: 'pointer',
            zIndex: 2,
          }}
          onClick={() => setUseMaximum(true)}
        >
          {t('send:max')}:{' '}
          {new BigNumber(spendableBalance)
            .dividedBy(10 ** blockchainConfig.decimals)
            .toFixed()}
        </Button>
        <Form.Item
          label={t('send:max_fee')}
          name="fee"
          style={{ paddingTop: '2px' }}
          rules={[{ required: true, message: t('send:invalid_tx_fee') }]}
        >
          <Input
            size="large"
            value={txFee}
            placeholder={t('send:max_tx_fee')}
            suffix={blockchainConfig.symbol}
            onChange={(e) => setTxFee(e.target.value)}
            disabled={true}
          />
        </Form.Item>
        <Collapse
          size="small"
          style={{ marginTop: '-20px', textAlign: 'left' }}
          items={[
            {
              key: '1',
              label: t('send:fee_details'),
              children: (
                <div>
                  <Form.Item
                    label={t('send:base_gas_price')}
                    name="fee"
                    rules={[
                      { required: true, message: t('send:input_gas_price') },
                    ]}
                  >
                    <Input
                      size="large"
                      value={baseGasPrice}
                      placeholder={t('send:input_gas_price')}
                      suffix="gwei"
                      onChange={(e) => setBaseGasPrice(e.target.value)}
                      disabled={!manualFee}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('send:priority_gas_price')}
                    name="fee"
                    rules={[
                      {
                        required: true,
                        message: t('send:input_priority_gas_price'),
                      },
                    ]}
                  >
                    <Input
                      size="large"
                      value={baseGasPrice}
                      placeholder={t('send:input_priority_gas_price')}
                      suffix="gwei"
                      onChange={(e) => setPriorityGasPrice(e.target.value)}
                      disabled={!manualFee}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('send:total_gas_limit')}
                    name="fee"
                    rules={[
                      { required: true, message: t('send:input_gas_limit') },
                    ]}
                  >
                    <Input
                      size="large"
                      value={baseGasPrice}
                      placeholder={t('send:input_gas_limit')}
                      suffix="gas"
                      onChange={(e) => setTotalGasLimit(e.target.value)}
                      disabled={!manualFee}
                    />
                  </Form.Item>
                </div>
              ),
            },
          ]}
        />
        <Button
          type="text"
          size="small"
          style={{
            float: 'left',
            marginLeft: 3,
            fontSize: 12,
            color: '#4096ff',
            cursor: 'pointer',
            zIndex: 2,
          }}
          onClick={() => {
            setManualFee(!manualFee);
          }}
        >
          {manualFee
            ? t('send:using_manual_fee')
            : t('send:using_automatic_fee')}
        </Button>

        <Form.Item style={{ marginTop: 50 }}>
          <Space direction="vertical" size="middle">
            {state.utxos?.length && (
              <div
                style={{
                  fontSize: 12,
                  color: 'grey',
                }}
              >
                <Popover content={content} title={t('send:replace_by_fee_tx')}>
                  <QuestionCircleOutlined style={{ color: 'blue' }} />{' '}
                </Popover>{' '}
                {t('send:replace_by_fee_tx')}
              </div>
            )}
            <Popconfirm
              title={t('send:confirm_tx')}
              description={
                <>
                  {t('send:tx_to_sspkey')}
                  <br />
                  {t('send:double_check_tx')}
                </>
              }
              overlayStyle={{ maxWidth: 360, margin: 10 }}
              okText={t('send:send')}
              cancelText={t('common:cancel')}
              onConfirm={() => {
                form.submit();
              }}
              icon={<QuestionCircleOutlined style={{ color: 'green' }} />}
            >
              <Button type="primary" size="large">
                {t('send:send')}
              </Button>
            </Popconfirm>
            <Button type="link" block size="small" onClick={cancelSend}>
              {t('common:cancel')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
      <ConfirmTxKey
        open={openConfirmTx}
        openAction={confirmTxAction}
        txHex={txHex}
        chain={activeChain}
        wallet={walletInUse}
      />
      <TxSent
        open={openTxSent}
        openAction={txSentAction}
        txid={txid}
        chain={txChain}
      />
      <TxRejected open={openTxRejected} openAction={txRejectedAction} />
      <SspConnect />
      <PoweredByFlux />
    </>
  );
}

export default SendEVM;
