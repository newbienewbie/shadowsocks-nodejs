## handshake

### client --> sslocal

```
+----+----------+----------+
|VER | NMETHODS | METHODS  |
+----+----------+----------+
| 1  |    1     |  1~255   |
+----+----------+----------+
```
* VER : VERSION ,0x05
* NMETHODS : Bytes of Methods
* METHODS : the methods supported by client

### sslocal --> client

```
+----+--------+
|VER | METHOD |
+----+--------+
| 1  |   1    |
+----+--------+
```

here :
* VER : VERSION ,0x05
* METHOD:
    * 0x00：no auth
    * 0xff：none of auth methods is supported

## connection

### client -->  sslocal :

```
# +----+-----+-------+------+----------+----------+
# |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
# +----+-----+-------+------+----------+----------+
# | 1  |  1  | X'00' |  1   | Variable |    2     |
# +----+-----+-------+------+----------+----------+
```
* VER      : version 
* CMD      : command 
* RSV      : reserved ，0x00 
* ATYP     : Address Type
    * 0x01 : IPv4 , 4Bytes
    * 0x03 : the length of DomainName  (1 Byte) +  the DomainName
    * 0x04 : IPv6 , 16Bytes
* DST.ADDR : destination.address
* DST.PORT : destination.port

### sslocal --> client :

```
    +----+-----+-------+------+----------+----------+
    |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
    +----+-----+-------+------+----------+----------+
    | 1  |  1  |   1   |  1   | Variable |    2     |
    +----+-----+-------+------+----------+----------+
```
* VER      : version 
* REP      : REPLY 
* RSV      : reserved ，0x00 
* ATYP     : Address Type
* BND.ADDR : the address of local server
* BND.PORT : the port of local server 

## transport

just pipe the local to remote and pipe the remote to local .
